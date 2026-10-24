"""Deadline-bounded classical warm start + sampled QAOA large-neighborhood search.

A classical-exact ablation uses the SAME neighborhood family, without a quantum circuit.
Any speed/quality gain of the complete hybrid is not attributed automatically to Qiskit.
"""
from itertools import permutations
from time import perf_counter,time
import json
import subprocess
import math
from pathlib import Path
import numpy as np
from scipy.optimize import minimize
from qiskit.quantum_info import Statevector
from qiskit.primitives import StatevectorSampler
from quantum_demo import make_circuit

ROOT=Path(__file__).resolve().parent
class DeadlineReached(Exception):pass


def classical(instance,initial,method,seed,budget_seconds):
    started=perf_counter();deadline=time()+budget_seconds
    p=subprocess.run(['node',str(ROOT/'timed_solver.js')],input=json.dumps({'instance':instance,'initial':initial,'method':method,'seed':seed,'deadline_epoch':deadline}),text=True,capture_output=True,check=True,timeout=budget_seconds+10,cwd=ROOT)
    r=json.loads(p.stdout);r['seconds']=perf_counter()-started;r['budget_seconds']=budget_seconds
    return r


def improved(instance,initial,seed=7,budget_seconds=1,layers=2,shots=1024,maxiter=40,ablation=False):
    start=perf_counter();deadline=start+budget_seconds;n=len(initial);m=len(instance['positions'])
    f=np.array(instance['flow']);d=np.array(instance['distances']);ii,kk=np.triu_indices(n,1);weights=f[ii,kk]
    def costs(p):
        a=np.asarray(p,dtype=int);return (d[a[:,ii],a[:,kk]]*weights).sum(axis=1)
    initial_cost=float(costs([initial])[0])
    # Warm start is charged to the SAME total budget, never borrowed from another solver's output.
    warm=classical(instance,initial,'hybrid',seed,min(.15,budget_seconds*.2))
    best=warm['assignment'].copy();best_cost=float(warm['cost']);current=best.copy()
    trace=[{'step':0,'cost':initial_cost,'seconds':0},{'step':1,'cost':best_cost,'seconds':perf_counter()-start}]
    rng=np.random.default_rng(seed);angles_rng=np.random.default_rng(seed+1000003)
    blocks=[];valid=0;total_shots=0;evaluations=0;last=None;setup=training=sampling=0.;stall=0
    previous_angles=None
    while perf_counter()<deadline:
        t=perf_counter()
        # A stalled search is diversified, but the best feasible incumbent is never discarded.
        if stall>=2:
            current=best.copy();perturb=rng.choice(n,size=min(6,n),replace=False);slots=[current[j] for j in perturb];rng.shuffle(slots)
            for j,s in zip(perturb,slots):current[int(j)]=int(s)
            stall=0
        contributions=f*d[np.ix_(current,current)]
        anchor=int(rng.choice(n,p=(contributions.sum(axis=1)+1)/(contributions.sum()+n)))
        scores=contributions[anchor]+f[anchor]+1;scores[anchor]=0
        others=rng.choice(n,size=min(3,n-1),replace=False,p=scores/scores.sum()).tolist();group=[anchor]+others
        choices=[current[j] for j in group];empty=sorted(set(range(m))-set(current))
        if empty:choices.append(empty[len(blocks)%len(empty)])
        candidates=[]
        for perm in permutations(choices,len(group)):
            p=current.copy()
            for j,s in zip(group,perm):p[j]=s
            candidates.append(p)
        values=costs(candidates);count=len(candidates);qubits=math.ceil(math.log2(count))
        penalty=float(values.max()+max(1,float(np.ptp(values))));base=float(values.min());scale=max(1,penalty-base)
        raw=np.full(2**qubits,penalty);raw[:count]=values;energies=(raw-base)/scale
        setup+=perf_counter()-t
        if perf_counter()>=deadline:break
        before=best_cost
        if ablation:
            idx=int(values.argmin());counts={};fraction=1.;expected=None
        else:
            t=perf_counter();ordered=np.argsort(energies);local=[];best_angles=None;best_objective=float('inf')
            def objective(angles):
                nonlocal best_angles,best_objective
                if perf_counter()>=deadline-.012:raise DeadlineReached()
                probs=Statevector.from_instruction(make_circuit(angles,energies,layers)).probabilities()[ordered]
                # Exact lower-tail CVaR (alpha=.25), not a replacement of the measured final solution.
                mass=np.minimum(probs,np.maximum(0,.25-(np.cumsum(probs)-probs)))
                score=float(mass@energies[ordered]/.25);local.append(score)
                if score<best_objective:best_objective=score;best_angles=np.array(angles)
                return score
            x=previous_angles.copy() if previous_angles is not None else angles_rng.uniform(0,np.pi,2*layers)
            try:minimize(objective,x,method='COBYLA',options={'maxiter':maxiter,'rhobeg':.6})
            except DeadlineReached:pass
            training+=perf_counter()-t;evaluations+=len(local)
            if best_angles is None or perf_counter()>=deadline-.006:break
            previous_angles=best_angles;t=perf_counter();qc=make_circuit(best_angles,energies,layers);qc.measure_all()
            counts=StatevectorSampler(seed=seed+len(blocks)).run([qc],shots=shots).result()[0].data.meas.get_counts()
            sampling+=perf_counter()-t
            # A block completed too late cannot improve the reported budget-constrained incumbent.
            if perf_counter()>deadline:break
            last=qc;feasible={int(b,2):int(v) for b,v in counts.items() if int(b,2)<count}
            valid+=sum(feasible.values());total_shots+=shots;fraction=sum(feasible.values())/shots
            idx=min(feasible,key=lambda j:values[j]) if feasible else None
            expected=float(best_objective*scale+base)
        if perf_counter()>deadline:break
        if idx is not None:
            current=candidates[idx]
            if values[idx]<best_cost-1e-9:best=current.copy();best_cost=float(values[idx]);stall=0
            else:stall+=1
        else:stall+=1
        blocks.append({'products':group,'candidate_count':count,'qubits':0 if ablation else qubits,'counts':counts,
                       'before':before,'after':best_cost,'accepted':best_cost<before,'valid_fraction':fraction,
                       'cvar_energy':expected,'assignment_after':best.copy(),'seconds':perf_counter()-start})
        trace.append({'step':len(trace),'cost':best_cost,'seconds':perf_counter()-start})
        if instance.get('optimum') is not None and best_cost<=instance['optimum'] and (ablation or last is not None):break
    result={'id':'ablation' if ablation else 'qiskit','label':'Mismo híbrido sin Qiskit' if ablation else 'Clásico + QAOA · Qiskit',
      'assignment':best,'cost':best_cost,'seconds':perf_counter()-start,'budget_seconds':budget_seconds,
      'start_mode':'shared','initial_assignment':initial,'history':trace,'warm_start':warm,
      'warm_start_cost':warm['cost'],'qiskit_additional_gain':float(warm['cost'])-best_cost if not ablation else None,
      'blocks':blocks,'setup_seconds':setup,'training_seconds':training,'sampling_seconds':sampling,
      'valid_fraction':valid/total_shots if total_shots else None,'total_shots':total_shots,'evaluations':evaluations,
      'qubits':max((b['qubits'] for b in blocks),default=0),'accepted_blocks':sum(b['accepted'] for b in blocks),
      'circuit':str(last.draw(output='text',fold=110)) if last else 'Ningún circuito final medido dentro del presupuesto.',
      'options':{'seed':seed,'layers':layers,'shots_per_block':shots,'maxiter':maxiter,'training':'CVaR alpha=0.25; angle reuse'},
      'budget_policy':'Warm start, oracle construction, training and sampling charged. Only completed-before-deadline incumbents accepted.',
      'quantum_executed':last is not None,'ablation':ablation}
    return result
