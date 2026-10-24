"""QAP10 interpreted as product storage; hybrid QAOA and exact reference."""
import argparse
import importlib.metadata
from itertools import permutations, islice
from pathlib import Path
from time import perf_counter
import json
import numpy as np
from scipy.optimize import minimize
from qiskit.quantum_info import Statevector
from qiskit.primitives import StatevectorSampler
from quantum_demo import cost, make_circuit
from qap10_data import load_qap10, PRODUCTS, SOURCE_URL

N=10
FLOW,DISTANCE,POSITIONS=load_qap10()


def initial_layout(seed=7):
    if int(seed)<0: raise ValueError('Semilla >= 0.')
    p=list(map(int,np.random.default_rng(int(seed)).permutation(N)))
    return p,cost(p,FLOW,DISTANCE)


def exact_reference(batch_size=10000):
    """Streaming enumeration: bounded memory, no list of 10! permutations."""
    start=perf_counter(); iterator=permutations(range(N)); best=None; best_cost=float('inf'); evaluated=0
    while True:
        batch=list(islice(iterator,batch_size))
        if not batch: break
        a=np.fromiter((v for p in batch for v in p),dtype=np.int16,count=len(batch)*N).reshape(len(batch),N); values=np.zeros(len(a),dtype=np.int64)
        for i in range(N):
            for k in range(i+1,N): values+=FLOW[i,k]*DISTANCE[a[:,i],a[:,k]]
        idx=int(np.argmin(values));evaluated+=len(a)
        if int(values[idx])<best_cost: best_cost=int(values[idx]);best=a[idx].tolist()
    return best,best_cost,perf_counter()-start,evaluated


def experiment(layers=2,shots=1024,seed=7,maxiter=40,rounds=2):
    layers,shots,seed,maxiter,rounds=map(int,(layers,shots,seed,maxiter,rounds))
    if not 1<=layers<=3 or shots<1 or seed<0 or maxiter<10 or not 1<=rounds<=5:
        raise ValueError('Capas 1–3; shots positivos; semilla >=0; evaluaciones >=10; rondas 1–5.')
    total_start=perf_counter(); initial,initial_cost=initial_layout(seed); current=initial.copy()
    rng=np.random.default_rng(seed); history=[initial_cost]; blocks=[]; evaluations=0;valid_shots=0
    setup_seconds=0.;train_seconds=0.;sample_seconds=0.;last_circuit=None
    # Independent exact reference runs AFTER the hybrid search, never used to guide it.
    for round_idx in range(rounds):
        order=rng.permutation(N).tolist()
        for offset in (0,3,6,9):
            selected=[order[(offset+j)%N] for j in range(4)]
            before_assignment=current.copy()
            stations=[current[i] for i in selected]
            start=perf_counter();candidates=[];local_costs=[]
            for perm in permutations(stations):
                p=current.copy()
                for route,station in zip(selected,perm):p[route]=station
                candidates.append(p);local_costs.append(cost(p,FLOW,DISTANCE))
            values=np.array(local_costs); penalty=int(values.max()+max(1,np.ptp(values)))
            # Includes costs involving ALL ten routes, including the six fixed routes.
            raw=np.full(32,penalty,dtype=float);raw[:24]=values
            # Shift and scale preserve minimizers while improving phase resolution.
            base=int(values.min());scale=max(1,penalty-base);energies=(raw-base)/scale
            setup_seconds+=perf_counter()-start
            start=perf_counter();local_history=[]
            def objective(angles):
                probs=Statevector.from_instruction(make_circuit(angles,energies,layers)).probabilities()
                energy=float(probs@energies);local_history.append(energy*scale+base);return energy
            opt=minimize(objective,rng.uniform(0,np.pi,2*layers),method='COBYLA',options={'maxiter':maxiter,'rhobeg':.8})
            evaluations+=len(local_history);train_seconds+=perf_counter()-start
            start=perf_counter();qc=make_circuit(opt.x,energies,layers);qc.measure_all();last_circuit=qc
            counts=StatevectorSampler(seed=seed+len(blocks)).run([qc],shots=shots).result()[0].data.meas.get_counts()
            feasible={int(bits,2):int(v) for bits,v in counts.items() if int(bits,2)<24}
            valid_shots+=sum(feasible.values());sample_seconds+=perf_counter()-start
            best_idx=min(feasible,key=lambda idx:values[idx]) if feasible else None
            before=cost(current,FLOW,DISTANCE)
            accepted=best_idx is not None and int(values[best_idx])<before
            if accepted: current=candidates[best_idx]
            after=cost(current,FLOW,DISTANCE);history.append(after)
            blocks.append({'round':round_idx+1,'products':[i+1 for i in selected],'assignment_before':before_assignment,'assignment_after':current.copy(),'before':before,'after':after,
                           'accepted':bool(accepted),'best_sample_cost':int(values[best_idx]) if best_idx is not None else None,
                           'feasible_fraction':sum(feasible.values())/shots,'counts':counts,
                           'expected_penalized_energy':float(opt.fun*scale+base),'penalty':penalty,
                           'optimizer_success':bool(opt.success),'optimizer_message':str(opt.message),
                           'angles':opt.x.tolist(),'history':local_history})
    hybrid_seconds=perf_counter()-total_start
    classical,classical_cost,classical_seconds,classical_evaluations=exact_reference()
    if classical_cost!=340:raise ValueError(f'qap10 scale error: {classical_cost} != 340')
    final_cost=cost(current,FLOW,DISTANCE)
    return {'products':PRODUCTS,'flow':FLOW.tolist(),'distances':DISTANCE.tolist(),'positions':POSITIONS.tolist(),
            'initial':initial,'initial_cost':initial_cost,'classical':classical,'classical_cost':classical_cost,
            'quantum':current,'quantum_cost':final_cost,'gap_percent':100*(final_cost-classical_cost)/classical_cost,
            'improvement_percent':100*(initial_cost-final_cost)/initial_cost,'history':history,'blocks':blocks,
            'classical_seconds':classical_seconds,'classical_evaluations':classical_evaluations,
            'hybrid_seconds':hybrid_seconds,'setup_seconds':setup_seconds,'training_seconds':train_seconds,
            'sampling_seconds':sample_seconds,'total_seconds':perf_counter()-total_start,
            'feasible_fraction':valid_shots/(shots*len(blocks)),'assignment_feasible':sorted(current)==list(range(N)),
            'shots_per_block':shots,'total_shots':shots*len(blocks),'qubits_per_circuit':5,'layers':layers,
            'seed':seed,'rounds':rounds,'maxiter_per_block':maxiter,'evaluations':evaluations,
            'accepted_blocks':sum(b['accepted'] for b in blocks),'circuit':str(last_circuit.draw(output='text',fold=100)),
            'versions':{p:importlib.metadata.version(p) for p in ['qiskit','numpy','scipy','fastapi']},
            'instance':'MIPLIB qap10; costo por pareja una sola vez; óptimo de referencia 340.',
            'source_url':SOURCE_URL,'reference_optimum':340,
            'method':'Híbrido: QAOA en vecindarios de 4 productos, costo global, aceptación clásica solo si mejora. Sin reparación.',
            'backend':'Simulación ideal local Qiskit; no QPU ni ventaja cuántica demostrada.'}


def draw_layout(ax, assignment, title, reference=None, highlight=None):
    from matplotlib.patches import Rectangle
    for i in range(N):
        for k in range(i+1,N):
            chosen=highlight is not None and {i,k}==set(highlight)
            if FLOW[i,k]<10 and not chosen:continue
            a,b=POSITIONS[assignment[i]],POSITIONS[assignment[k]]
            ax.plot([a[0],b[0]],[a[1],b[1]],color='#ad4e26' if chosen else '#15694e',
                    alpha=.95 if chosen else .16,lw=3 if chosen else FLOW[i,k]/6,zorder=1)
    for i,slot in enumerate(assignment):
        x,y=POSITIONS[slot];changed=reference is not None and slot!=reference[i]
        ax.add_patch(Rectangle((x-.43,y-.32),.86,.64,facecolor='#cce6c6' if changed else '#f0f3ec',edgecolor='#15694e',zorder=2))
        ax.text(x,y+.06,PRODUCTS[i],ha='center',fontsize=9,zorder=3)
        ax.text(x,y-.17,f'Ubicación {slot+1}',ha='center',fontsize=7,zorder=3)
    ax.set_title(title)
    ax.set(xlim=(-.6,3.6),ylim=(-.6,2.6),aspect='equal');ax.axis('off')


def plot_initial(seed=7):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    p,c=initial_layout(seed)
    fig,ax=plt.subplots(figsize=(7,4),layout='constrained')
    draw_layout(ax,p,f'Antes de optimizar · costo {c}')
    return fig


def pair_rows(result):
    rows=[]
    for i in range(N):
        for k in range(i+1,N):
            before=int(DISTANCE[result['initial'][i],result['initial'][k]])
            after=int(DISTANCE[result['quantum'][i],result['quantum'][k]])
            f=int(FLOW[i,k]);rows.append([PRODUCTS[i],PRODUCTS[k],f,before,after,f*before,f*after,f*(before-after)])
    return sorted(rows,key=lambda r:r[-1],reverse=True)


def plot_result(result):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    rows=pair_rows(result);pair=(PRODUCTS.index(rows[0][0]),PRODUCTS.index(rows[0][1]))
    fig,axes=plt.subplots(1,3,figsize=(16,5),layout='constrained')
    for ax,key,title in zip(axes,['initial','classical','quantum'],['Inicial','Referencia clásica exacta','Híbrido QAOA · Qiskit']):
        draw_layout(ax,result[key],f'{title}\nCosto {result[key+"_cost"]}',result['initial'] if key!='initial' else None,pair)
    fig.suptitle('10 productos · posiciones y distancias qap10 · verde: cambió de ubicación · naranja: pareja explicada')
    return fig


def plot_history(result):
    import matplotlib.pyplot as plt
    fig,ax=plt.subplots(figsize=(8,3),layout='constrained')
    ax.plot(range(len(result['history'])),result['history'],marker='o',label='Híbrido QAOA')
    ax.axhline(result['classical_cost'],color='#ad4e26',linestyle='--',label='Óptimo exacto de esta instancia')
    ax.set(xlabel='Vecindarios procesados (0 = inicial)',ylabel='Costo global');ax.legend()
    return fig


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--seed',type=int,default=7);p.add_argument('--rounds',type=int,default=2)
    p.add_argument('--shots',type=int,default=1024);p.add_argument('--iterations',type=int,default=40)
    p.add_argument('--layers',type=int,default=2);p.add_argument('--output',default='results/qap10_warehouse.json');a=p.parse_args()
    r=experiment(a.layers,a.shots,a.seed,a.iterations,a.rounds)
    r['pair_contributions']=[dict(zip(['product_a','product_b','weight','initial_distance','final_distance','initial_cost','final_cost','saving'],row)) for row in pair_rows(r)]
    path=Path(a.output);path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n')
    plot_result(r).savefig(path.with_suffix('.png'),dpi=150)
    plot_history(r).savefig(path.with_name(path.stem+'_history.png'),dpi=150)
    print(json.dumps({k:r[k] for k in ['initial_cost','classical_cost','quantum_cost','gap_percent','improvement_percent','feasible_fraction','hybrid_seconds','classical_seconds','classical_evaluations']},indent=2))
