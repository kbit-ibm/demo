"""Qiskit QAOA local search for rectangular warehouse instances, including empty slots."""
from itertools import permutations
from time import perf_counter
import math
import numpy as np
from scipy.optimize import minimize
from qiskit.quantum_info import Statevector
from qiskit.primitives import StatevectorSampler
from quantum_demo import make_circuit


def solve(instance,initial,layers=2,shots=1024,seed=7,maxiter=40,rounds=2):
    started=perf_counter();f=np.array(instance['flow']);d=np.array(instance['distances'])
    n=len(initial);m=len(d);ii,kk=np.triu_indices(n,1);weights=f[ii,kk]
    def costs(assignments):
        a=np.asarray(assignments,dtype=int)
        return (d[a[:,ii],a[:,kk]]*weights).sum(axis=1)
    current=list(initial);history=[float(costs([current])[0])];blocks=[];rng=np.random.default_rng(seed)
    valid_shots=0;total_shots=0;setup=0.;training=0.;sampling=0.;evaluations=0;last=None
    for round_id in range(rounds):
        order=rng.permutation(n).tolist()
        for offset in range(0,n,3):
            selected=[order[(offset+j)%n] for j in range(min(4,n))]
            before_assignment=current.copy();start=perf_counter()
            choices=[current[i] for i in selected]
            empty=sorted(set(range(m))-set(current))
            if empty: choices.append(empty[len(blocks)%len(empty)])
            candidates=[]
            for perm in permutations(choices,len(selected)):
                candidate=current.copy()
                for item,slot in zip(selected,perm):candidate[item]=slot
                candidates.append(candidate)
            values=costs(candidates);count=len(values);qubits=math.ceil(math.log2(count))
            penalty=float(values.max()+max(1,float(np.ptp(values))))
            raw=np.full(2**qubits,penalty);raw[:count]=values
            base=float(values.min());scale=max(1,penalty-base);energies=(raw-base)/scale
            setup+=perf_counter()-start;start=perf_counter();energy_trace=[]
            def objective(angles):
                probs=Statevector.from_instruction(make_circuit(angles,energies,layers)).probabilities()
                expected=float(probs@energies);energy_trace.append(expected*scale+base);return expected
            opt=minimize(objective,rng.uniform(0,np.pi,2*layers),method='COBYLA',options={'maxiter':maxiter,'rhobeg':.8})
            training+=perf_counter()-start;evaluations+=len(energy_trace);start=perf_counter()
            qc=make_circuit(opt.x,energies,layers);qc.measure_all();last=qc
            counts=StatevectorSampler(seed=seed+len(blocks)).run([qc],shots=shots).result()[0].data.meas.get_counts()
            feasible={int(bits,2):int(v) for bits,v in counts.items() if int(bits,2)<count}
            valid_shots+=sum(feasible.values());total_shots+=shots;sampling+=perf_counter()-start
            candidate_idx=min(feasible,key=lambda idx:values[idx]) if feasible else None
            previous=history[-1];accepted=candidate_idx is not None and values[candidate_idx]<previous-1e-9
            if accepted:current=candidates[candidate_idx]
            value=float(costs([current])[0]);history.append(value)
            blocks.append({'round':round_id+1,'products':selected,'before':previous,'after':value,'accepted':bool(accepted),
                'assignment_before':before_assignment,'assignment_after':current.copy(),'qubits':qubits,
                'candidate_count':count,'empty_slot_offered':choices[-1] if empty else None,'counts':counts,
                'valid_fraction':sum(feasible.values())/shots,'expected_penalized_energy':float(opt.fun*scale+base),
                'penalty':penalty,'angles':opt.x.tolist(),'optimizer_success':bool(opt.success),'optimizer_message':str(opt.message),
                'training_energy_history':energy_trace})
    return {'id':'qiskit','label':'Híbrido QAOA · Qiskit','assignment':current,'cost':history[-1],
        'seconds':perf_counter()-started,'start_mode':'shared','history':[{'step':i,'cost':c} for i,c in enumerate(history)],
        'setup_seconds':setup,'training_seconds':training,'sampling_seconds':sampling,
        'valid_fraction':valid_shots/total_shots,'total_shots':total_shots,'evaluations':evaluations,
        'qubits':max(b['qubits'] for b in blocks),'accepted_blocks':sum(b['accepted'] for b in blocks),'blocks':blocks,
        'circuit':str(last.draw(output='text',fold=110)),
        'options':{'seed':seed,'layers':layers,'shots_per_block':shots,'maxiter':maxiter,'rounds':rounds}}
