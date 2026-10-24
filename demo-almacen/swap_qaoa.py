"""Permutation-feasible simultaneous swaps, polynomial QUBO construction, fixed-ramp QAOA.

Each qubit chooses whether to swap one DISJOINT pair of items. Empty slots are
represented by zero-flow dummy items. No permutation list or diagonal lookup
oracle is built on the quantum path. LR schedule follows Eq. (5) of
https://doi.org/10.1038/s41534-025-01082-1 ; no performance claim is inherited.
"""
from dataclasses import dataclass
from time import perf_counter
import numpy as np
from qiskit import QuantumCircuit
from qiskit.primitives import StatevectorSampler


@dataclass
class SwapModel:
    assignment: np.ndarray
    real_items: int
    pairs: tuple
    constant: float
    linear: np.ndarray
    quadratic: np.ndarray  # upper triangular, each interaction counted once
    construction_evaluations: int

    @property
    def qubits(self):return len(self.pairs)

    def decode(self,bits,full=False):
        bits=np.asarray(bits)
        if bits.shape!=(self.qubits,) or not np.isin(bits,[0,1]).all():
            raise ValueError('One binary decision is required for each swap.')
        p=self.assignment.copy()
        for bit,(a,b) in zip(bits,self.pairs):
            if bit:p[a],p[b]=p[b],p[a]
        return p.tolist() if full else p[:self.real_items].tolist()

    def evaluate(self,bits):
        z=np.asarray(bits,dtype=float)
        if z.ndim==1:z=z[None,:]
        if z.ndim!=2 or z.shape[1]!=self.qubits or not np.isin(z,[0,1]).all():
            raise ValueError('Invalid swap decisions.')
        return self.constant+z@self.linear+np.einsum('bi,ij,bj->b',z,self.quadratic,z)

    def ising(self):
        h=-self.linear/2-(self.quadratic.sum(axis=0)+self.quadratic.sum(axis=1))/4
        J=self.quadratic/4
        offset=self.constant+self.linear.sum()/2+self.quadratic.sum()/4
        return float(offset),h,J


def full_assignment(assignment,slots):
    p=list(assignment)
    if len(p)>slots or len(set(p))!=len(p) or any(not isinstance(x,(int,np.integer)) or x<0 or x>=slots for x in p):
        raise ValueError('Assignment must have distinct valid slots.')
    return np.array(p+sorted(set(range(slots))-set(p)),dtype=int)


def build_model(instance,assignment,pairs):
    """Recover the exact degree-2 polynomial with 1 + k + k(k-1)/2 costs."""
    F=np.asarray(instance['flow'],dtype=float);D=np.asarray(instance['distances'],dtype=float)
    n=len(F);m=len(D)
    if F.shape!=(n,n) or D.shape!=(m,m) or len(assignment)!=n:
        raise ValueError('Inconsistent dimensions.')
    if not np.isfinite(F).all() or not np.isfinite(D).all():raise ValueError('Nonfinite coefficients.')
    p=full_assignment(assignment,m);pairs=tuple((int(a),int(b)) for a,b in pairs)
    used=[j for pair in pairs for j in pair]
    if not pairs or len(set(used))!=len(used) or min(used)<0 or max(used)>=m:
        raise ValueError('Swaps must be nonempty, disjoint pairs of valid item indices.')
    k=len(pairs);patterns=[np.zeros(k,dtype=int)]
    for j in range(k):
        z=np.zeros(k,dtype=int);z[j]=1;patterns.append(z)
    interactions=[]
    for j in range(k):
        for l in range(j+1,k):
            z=np.zeros(k,dtype=int);z[j]=z[l]=1;patterns.append(z);interactions.append((j,l))
    # Only polynomially many evaluations, never the full 2**k neighborhood.
    assignments=np.repeat(p[None,:],len(patterns),axis=0)
    for row,z in enumerate(patterns):
        for bit,(a,b) in zip(z,pairs):
            if bit:assignments[row,a],assignments[row,b]=assignments[row,b],assignments[row,a]
    i,j=np.triu_indices(n,1)
    values=(F[i,j]*D[assignments[:,i],assignments[:,j]]).sum(axis=1)
    constant=float(values[0]);linear=values[1:k+1]-constant;quadratic=np.zeros((k,k))
    for value,(j,l) in zip(values[k+1:],interactions):quadratic[j,l]=value-constant-linear[j]-linear[l]
    return SwapModel(p,n,pairs,constant,linear,quadratic,len(patterns))


def phase_layer(circuit,h,J,gamma,scale=1.):
    """exp(-i gamma H / scale); the constant contributes only a global phase."""
    for j,v in enumerate(h):
        if abs(v)>1e-12:circuit.rz(2*gamma*float(v)/scale,j)
    for j in range(len(h)):
        for l in range(j+1,len(h)):
            if abs(J[j,l])>1e-12:circuit.rzz(2*gamma*float(J[j,l])/scale,j,l)


def ramp_circuit(model,layers=2,delta_beta=.75,delta_gamma=.75,measure=True):
    """Fixed linear ramps; no variational optimizer or candidate-energy array."""
    if int(layers)!=layers or layers<1:raise ValueError('layers must be a positive integer')
    if not np.isfinite([delta_beta,delta_gamma]).all() or min(delta_beta,delta_gamma)<0:
        raise ValueError('Invalid ramp parameters')
    _,h,J=model.ising();scale=max(float(np.max(np.abs(h))),float(np.max(np.abs(J))),1.)
    qc=QuantumCircuit(model.qubits);qc.h(range(model.qubits))
    for layer in range(int(layers)):
        beta=(1-layer/layers)*delta_beta;gamma=(layer+1)/layers*delta_gamma
        phase_layer(qc,h,J,gamma,scale)
        qc.rx(2*beta,range(model.qubits))
    if measure:qc.measure_all()
    return qc


def sample_model(model,layers=2,shots=1024,seed=7,delta_beta=.75,delta_gamma=.75):
    if shots<1 or int(shots)!=shots:raise ValueError('shots must be positive')
    circuit=ramp_circuit(model,layers,delta_beta,delta_gamma)
    counts=StatevectorSampler(seed=seed).run([circuit],shots=int(shots)).result()[0].data.meas.get_counts()
    # Qiskit prints the highest-index qubit on the left. Qubit j controls pair j.
    keys=list(counts)
    bits=np.array([[(int(key,2)>>j)&1 for j in range(model.qubits)] for key in keys],dtype=int)
    values=model.evaluate(bits);idx=int(np.argmin(values))
    return {'assignment':model.decode(bits[idx]),'cost':float(values[idx]),'bits':bits[idx].tolist(),
            'counts':counts,'sample_evaluations':len(keys),'circuit':circuit}


def exact_model(model,deadline=None,batch_size=4096):
    """Classical control: stream the SAME binary neighborhood with bounded memory.

    This explicit exponential enumeration is used only by the classical control.
    Never substituted for quantum samples in the Qiskit branch.
    """
    best_bits=np.zeros(model.qubits,dtype=int);best=model.constant;evaluated=0;complete=True
    for start in range(0,2**model.qubits,batch_size):
        if deadline is not None and perf_counter()>=deadline:complete=False;break
        ints=np.arange(start,min(start+batch_size,2**model.qubits),dtype=np.uint64)
        bits=((ints[:,None]>>np.arange(model.qubits,dtype=np.uint64))&1).astype(np.int8)
        values=model.evaluate(bits)
        if deadline is not None and perf_counter()>deadline:complete=False;break
        evaluated+=len(bits);idx=int(np.argmin(values))
        if values[idx]<best:best=float(values[idx]);best_bits=bits[idx].copy()
    return {'assignment':model.decode(best_bits),'cost':float(best),'bits':best_bits.tolist(),
            'sample_evaluations':evaluated,'complete':complete,'counts':{}}


def solve_swaps(instance,initial,warm_solver,seed=7,budget_seconds=1.,layers=2,shots=1024,
                ablation=False,max_swaps=12,delta_beta=.75,delta_gamma=.75):
    """Time-bounded outer search; every QAOA decision decodes to a feasible layout."""
    if budget_seconds<.1 or int(max_swaps)!=max_swaps or max_swaps<1:
        raise ValueError('budget_seconds >= .1 and positive integer max_swaps required')
    started=perf_counter();deadline=started+budget_seconds;n=len(initial);m=len(instance['positions'])
    F=np.array(instance['flow']);D=np.array(instance['distances']);ii,jj=np.triu_indices(n,1)
    def actual(p):return float((F[ii,jj]*D[np.array(p)[ii],np.array(p)[jj]]).sum())
    full_assignment(initial,m);initial_cost=actual(initial)
    warm=warm_solver(instance,initial,'hybrid',seed,min(.15,budget_seconds*.2))
    best=list(warm['assignment']);best_cost=actual(best);current=best.copy();rng=np.random.default_rng(seed)
    trace=[{'step':0,'cost':initial_cost,'seconds':0},
           {'step':1,'cost':best_cost,'seconds':perf_counter()-started}]
    blocks=[];stall=0;setup=sampling=0.;evaluations=sample_evaluations=total_shots=0
    last=None;attempted_shots=0;discarded_late_blocks=0;model_peak_bytes=statevector_peak_bytes=0
    while perf_counter()<deadline:
        # Re-pairing across iterations allows different products to exchange positions.
        if stall>=2:
            current=best.copy();chosen=rng.choice(n,size=min(6,n),replace=False);slots=[current[j] for j in chosen];rng.shuffle(slots)
            for j,s in zip(chosen,slots):current[int(j)]=int(s)
            stall=0
        order=rng.permutation(m).tolist();k=min(int(max_swaps),m//2)
        if k==0:break
        pairs=list(zip(order[:2*k:2],order[1:2*k:2]));before_assignment=current.copy()
        t=perf_counter();model=build_model(instance,current,pairs)
        setup+=perf_counter()-t;evaluations+=model.construction_evaluations
        model_peak_bytes=max(model_peak_bytes,model.linear.nbytes+model.quadratic.nbytes+model.assignment.nbytes)
        statevector_peak_bytes=max(statevector_peak_bytes,16*(2**k))
        if perf_counter()>=deadline:break
        t=perf_counter()
        if ablation:proposal=exact_model(model,deadline)
        else:
            proposal=sample_model(model,layers,shots,seed+len(blocks),delta_beta,delta_gamma);attempted_shots+=shots
        sampling+=perf_counter()-t
        if perf_counter()>deadline:
            discarded_late_blocks+=1;break  # Late answers cannot improve the budget-limited result.
        sample_evaluations+=proposal['sample_evaluations']
        candidate=proposal['assignment'];candidate_cost=actual(candidate)
        if not np.isclose(candidate_cost,proposal['cost'],atol=1e-8,rtol=0):
            raise ValueError('Swap polynomial does not match the real assignment cost')
        if len(set(candidate))!=n:raise ValueError('Invalid decoded assignment')
        completed=perf_counter()-started
        if completed>budget_seconds:
            discarded_late_blocks+=1;break
        before=best_cost
        if candidate_cost<actual(current)-1e-9:current=candidate
        if candidate_cost<best_cost-1e-9:best=candidate.copy();best_cost=candidate_cost;stall=0
        else:stall+=1
        if not ablation:last=proposal['circuit'];total_shots+=shots
        blocks.append({'pairs':pairs,'products':sorted(set(j for pair in pairs for j in pair if j<n)),
            'qubits':k,'candidate_count':2**k,'construction_evaluations':model.construction_evaluations,
            'sample_evaluations':proposal['sample_evaluations'],'counts':proposal['counts'],
            'selected_bits':proposal['bits'],'sample_assignment':candidate,'sample_cost':candidate_cost,
            'assignment_before':before_assignment,'assignment_after':best.copy(),'before':before,'after':best_cost,
            'accepted':best_cost<before,'seconds':completed,'valid_fraction':1.,
            'constant':model.constant,'linear':model.linear.tolist(),'quadratic':model.quadratic.tolist()})
        trace.append({'step':len(trace),'cost':best_cost,'seconds':perf_counter()-started})
        if instance.get('optimum') is not None and best_cost<=instance['optimum']:break
    return {'id':'ablation' if ablation else 'qiskit','label':'Control clásico de intercambios' if ablation else 'Intercambios + LR-QAOA · Qiskit',
        'assignment':best,'cost':best_cost,'seconds':perf_counter()-started,'budget_seconds':budget_seconds,
        'start_mode':'shared','initial_assignment':list(initial),'history':trace,'warm_start':warm,
        'warm_start_cost':warm['cost'],'qiskit_additional_gain':float(warm['cost'])-best_cost if not ablation else None,
        'blocks':blocks,'setup_seconds':setup,'training_seconds':0.,'sampling_seconds':sampling,
        'valid_fraction':1. if total_shots else None,'total_shots':total_shots,'attempted_shots':attempted_shots,
        'discarded_late_blocks':discarded_late_blocks,'evaluations':evaluations,'sample_evaluations':sample_evaluations,
        'qubits':max((b['qubits'] for b in blocks),default=0),'accepted_blocks':sum(b['accepted'] for b in blocks),
        'circuit':str(last.draw(output='text',fold=110)) if last else 'Sin medición final dentro del presupuesto.',
        'quantum_executed':last is not None,'ablation':ablation,
        'model_peak_bytes':model_peak_bytes,'statevector_bytes_estimate':statevector_peak_bytes if not ablation else 0,
        'options':{'seed':seed,'layers':layers,'shots_per_block':shots,'max_swaps':max_swaps,
                   'delta_beta':delta_beta,'delta_gamma':delta_gamma,'training':'none; fixed linear ramp'},
        'budget_policy':'Warm start, QUBO construction and sampling charged; results after deadline discarded.',
        'encoding':'One qubit per disjoint swap; dummy items for empty slots; every bitstring is feasible; no penalties.',
        'algorithm':'simultaneous-swaps-lr-qaoa-v1'}


if __name__=='__main__':
    import argparse,json
    from pathlib import Path
    from comparison import preview
    from improved_solver import classical
    parser=argparse.ArgumentParser(description='Simultaneous-swap QUBO + fixed-ramp QAOA, no UI')
    parser.add_argument('--scenario',choices=['qap10','original'],default='qap10')
    parser.add_argument('--seed',type=int,default=7)
    parser.add_argument('--seconds',type=float,default=1.)
    parser.add_argument('--swaps',type=int,default=12)
    parser.add_argument('--layers',type=int,default=2)
    parser.add_argument('--shots',type=int,default=1024)
    parser.add_argument('--exact-control',action='store_true')
    parser.add_argument('--output',default='results/swap_qaoa.json')
    args=parser.parse_args();data=preview(args.scenario,args.seed)
    result=solve_swaps(data['instance'],data['initial'],classical,args.seed,args.seconds,
                       args.layers,args.shots,args.exact_control,args.swaps)
    result['instance_fingerprint']=data['instance']['fingerprint']
    target=Path(args.output);target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:result[k] for k in ['cost','seconds','qubits','total_shots','training_seconds',
        'warm_start_cost','qiskit_additional_gain','quantum_executed','evaluations','sample_evaluations']},indent=2))
