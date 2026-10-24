"""Small reproducible QAP experiment: QAOA in Qiskit, exact classical baseline."""
from __future__ import annotations
import argparse
from itertools import permutations
from math import ceil, log2
from pathlib import Path
import json
from time import perf_counter
import importlib.metadata
import numpy as np
from scipy.optimize import minimize
from qiskit import QuantumCircuit
from qiskit.circuit.library import DiagonalGate
from qiskit.quantum_info import Statevector
from qiskit.primitives import StatevectorSampler

PRODUCTS = ['Café', 'Azúcar', 'Galletas', 'Té']
AFFINITY = np.array([[0,10,8,3], [10,0,4,7], [8,4,0,9], [3,7,9,0]])
POSITIONS = np.array([[0,0], [1,0], [0,2], [1,2]])


def cost(assignment, affinity, distances):
    return int(sum(affinity[i,k] * distances[assignment[i],assignment[k]]
                   for i in range(len(assignment)) for k in range(i+1,len(assignment))))


def initial_layout(n=4, seed=7):
    """Same reproducible warehouse reference for preview and experiment; no optimization."""
    n, seed = int(n), int(seed)
    if n not in (3, 4) or seed < 0:
        raise ValueError('Usa 3 o 4 productos y semilla >= 0.')
    positions = POSITIONS[:n]
    distances = np.abs(positions[:,None,:]-positions[None,:,:]).sum(axis=2)
    assignment = tuple(map(int, np.random.default_rng(seed).permutation(n)))
    return assignment, cost(assignment, AFFINITY[:n,:n], distances)


def make_circuit(angles, energies, layers):
    """QAOA: |+>, exp(-i gamma H_cost), exp(-i beta sum X), repeated p times."""
    qubits = int(log2(len(energies)))
    qc = QuantumCircuit(qubits)
    qc.h(range(qubits))
    for layer in range(layers):
        qc.append(DiagonalGate(np.exp(-1j * angles[layer] * energies)), range(qubits))
        qc.rx(2 * angles[layers+layer], range(qubits))
    return qc


def experiment(n=4, layers=2, shots=2048, seed=7, maxiter=100):
    n, layers, shots, seed, maxiter = map(int, (n,layers,shots,seed,maxiter))
    if n not in (3,4) or not 1 <= layers <= 3 or shots < 1 or maxiter < 1 or seed < 0:
        raise ValueError('Usa 3 o 4 productos, 1–3 capas, shots/iteraciones positivos y semilla >= 0.')
    start = perf_counter()
    affinity = AFFINITY[:n,:n]
    positions = POSITIONS[:n]
    distances = np.abs(positions[:,None,:]-positions[None,:,:]).sum(axis=2)
    rng = np.random.default_rng(seed)
    initial, _ = initial_layout(n, seed)
    rng.permutation(n)  # Preserve the seeded optimizer starts used in the saved experiment.
    # Costs are built in lexicographic order, never sorted by quality or seeded with an optimum.
    setup_start = perf_counter()
    assignments = list(permutations(range(n)))
    costs = np.array([cost(p,affinity,distances) for p in assignments])
    qubits = ceil(log2(len(assignments)))
    # Unused basis states are invalid; their energy exceeds EVERY feasible cost.
    penalty = int(costs.max()+max(1, np.ptp(costs)))
    raw_energies = np.full(2**qubits, penalty, dtype=float)
    raw_energies[:len(costs)] = costs
    energies = raw_energies/penalty
    setup_seconds = perf_counter()-setup_start
    classical_start = perf_counter()
    # Baseline independently evaluates all permutations, including its own cost evaluations.
    classical = min(permutations(range(n)), key=lambda p: cost(p,affinity,distances))
    classical_cost = cost(classical,affinity,distances)
    classical_seconds = perf_counter()-classical_start
    quantum_start = perf_counter()
    history = []
    def objective(angles):
        probabilities = Statevector.from_instruction(make_circuit(angles,energies,layers)).probabilities()
        value = float(probabilities @ energies)
        history.append(value * penalty)
        return value
    # Two seeded starts; the classical optimum is not used in training or initialization.
    best = None
    for _ in range(2):
        result = minimize(objective, rng.uniform(0,np.pi,2*layers), method='COBYLA',
                          options={'maxiter':maxiter,'rhobeg':0.8})
        if best is None or result.fun < best.fun:
            best = result
    circuit = make_circuit(best.x,energies,layers)
    measured = circuit.copy()
    measured.measure_all()
    pub = StatevectorSampler(seed=seed).run([measured],shots=shots).result()[0]
    counts = pub.data.meas.get_counts()
    valid = {int(bits,2):int(count) for bits,count in counts.items() if int(bits,2)<len(assignments)}
    feasible_shots = sum(valid.values())
    # Pick only among sampled feasible states; no repair and no fallback to classical optimum.
    chosen = min(valid, key=lambda idx: (costs[idx],-valid[idx])) if valid else None
    quantum_seconds = perf_counter()-quantum_start
    quantum = assignments[chosen] if chosen is not None else None
    qcost = int(costs[chosen]) if chosen is not None else None
    return {
        'products':PRODUCTS[:n], 'affinity':affinity.tolist(), 'distances':distances.tolist(),
        'positions':positions.tolist(), 'initial':list(initial), 'initial_cost':cost(initial,affinity,distances),
        'classical':list(classical), 'classical_cost':classical_cost, 'classical_seconds':classical_seconds,
        'quantum':list(quantum) if quantum else None, 'quantum_cost':qcost,
        'gap_percent':100*(qcost-classical_cost)/classical_cost if qcost is not None else None,
        'feasible_fraction':feasible_shots/shots, 'shots':shots,'counts':counts,
        'optimal_sample_fraction':sum(count for idx,count in valid.items() if costs[idx]==classical_cost)/shots,
        'quantum_seconds':quantum_seconds,'setup_seconds':setup_seconds,'total_seconds':perf_counter()-start,
        'qubits':qubits,'layers':layers,'seed':seed,'maxiter_per_start':maxiter,'starts':2,
        'evaluations':len(history),'history':history,'penalty':penalty,
        'expected_penalized_energy':float(best.fun*penalty),
        'optimizer_success':bool(best.success),'optimizer_message':str(best.message),
        'angles':best.x.tolist(),'circuit':str(measured.draw(output='text',fold=100)),
        'versions':{p:importlib.metadata.version(p) for p in ['qiskit','numpy','scipy']},
        'encoding':'Índice lexicográfico de permutación; oráculo diagonal enumerado, no QUBO one-hot.',
        'backend':'Simulación local ideal de Qiskit; sin QPU, sin ruido.',
    }


def plot_result(result):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.patches import Rectangle
    fig, axes = plt.subplots(1,3,figsize=(12,4),layout='constrained')
    for ax,key,title in zip(axes,['initial','classical','quantum'],['Inicial','Clásico exacto','QAOA · Qiskit']):
        p = result[key]
        if p is None:
            ax.text(.5,.5,'Sin muestras factibles',ha='center'); ax.axis('off'); continue
        pos = np.array(result['positions'])
        affinity = result['affinity']
        for i in range(len(p)):
            for j in range(i+1,len(p)):
                a,b=pos[p[i]],pos[p[j]]
                ax.plot([a[0],b[0]],[a[1],b[1]],color='#15694e',alpha=.25,lw=affinity[i][j]/3,zorder=1)
        for i,place in enumerate(p):
            x,y=pos[place]
            ax.add_patch(Rectangle((x-.32,y-.25),.64,.5,facecolor='#e7eee5',edgecolor='#15694e',zorder=2))
            ax.text(x,y+.07,result['products'][i],ha='center',va='center',fontsize=9,zorder=3)
            ax.text(x,y-.11,f'Posición {place+1}',ha='center',fontsize=7,zorder=3)
        ax.set_title(f'{title}\nCosto: {result[key+"_cost"]}')
        ax.set(xlim=(-.5,1.5),ylim=(-.5,2.5),aspect='equal');ax.axis('off')
    fig.suptitle('Se mueven productos; las posiciones permanecen fijas. Líneas = afinidad.')
    return fig


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--products',type=int,choices=[3,4],default=4)
    parser.add_argument('--seed',type=int,default=7)
    parser.add_argument('--layers',type=int,choices=[1,2,3],default=2)
    parser.add_argument('--shots',type=int,default=2048)
    parser.add_argument('--iterations',type=int,default=100)
    parser.add_argument('--output',default='results/demo.json')
    args=parser.parse_args()
    result=experiment(args.products,args.layers,args.shots,args.seed,args.iterations)
    target=Path(args.output);target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    plot_result(result).savefig(target.with_suffix('.png'),dpi=160)
    print(json.dumps({k:result[k] for k in ['initial_cost','classical_cost','quantum_cost','gap_percent','feasible_fraction','quantum_seconds','qubits','versions']},indent=2))
    print(f'Evidencia: {target} y {target.with_suffix(".png")}')
