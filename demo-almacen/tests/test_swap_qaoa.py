"""Exact polynomial/circuit correctness and feasibility, independent of optimizer quality."""
import itertools
import unittest
from unittest.mock import patch
import numpy as np
from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector
from comparison import preview,value,validate
from swap_qaoa import build_model,phase_layer,ramp_circuit,sample_model,exact_model,solve_swaps


class SwapQAOATests(unittest.TestCase):
    def check_all(self,instance,assignment,pairs):
        model=build_model(instance,assignment,pairs);k=len(pairs)
        self.assertEqual(model.construction_evaluations,1+k+k*(k-1)//2)
        bits=np.array(list(itertools.product([0,1],repeat=k)),dtype=int)
        expected=np.array([value(instance,model.decode(z)) for z in bits])
        np.testing.assert_allclose(model.evaluate(bits),expected,rtol=0,atol=1e-9)
        for z in bits:validate(instance,model.decode(z))
        offset,h,J=model.ising();signs=1-2*bits
        ising=offset+signs@h+np.einsum('bi,ij,bj->b',signs,J,signs)
        np.testing.assert_allclose(ising,expected,rtol=0,atol=1e-9)
        return model

    def test_qap10_all_32_combinations_and_nonidentity_start(self):
        data=preview('qap10',19)
        self.check_all(data['instance'],data['initial'],[(0,4),(1,9),(2,8),(3,7),(5,6)])

    def test_empty_slots_are_zero_flow_dummy_items(self):
        instance={'products':['A','B','C'],'positions':[[i,0] for i in range(5)],
          'flow':[[0,7,2],[7,0,3],[2,3,0]],'distances':[[abs(i-j) for j in range(5)] for i in range(5)]}
        model=self.check_all(instance,[1,3,4],[(0,3),(1,4)])
        self.assertEqual(model.decode([1,1]),[0,2,4])
        self.assertEqual(len(set(model.decode([1,1],full=True))),5)

    def test_original_30_products_32_slots_random_masks(self):
        data=preview('original',42);order=np.random.default_rng(42).permutation(32)
        pairs=list(zip(order[::2],order[1::2]));model=build_model(data['instance'],data['initial'],pairs)
        self.assertEqual(model.qubits,16);self.assertEqual(model.construction_evaluations,137)
        bits=np.random.default_rng(9).integers(0,2,size=(200,16))
        for z,estimate in zip(bits,model.evaluate(bits)):
            decoded=model.decode(z);validate(data['instance'],decoded)
            self.assertAlmostEqual(value(data['instance'],decoded),estimate)

    def test_14_items_need_7_qubits_not_196(self):
        rng=np.random.default_rng(14);f=np.triu(rng.integers(0,10,(14,14)),1);f=f+f.T
        positions=np.array([[i%4,i//4] for i in range(14)]);d=np.abs(positions[:,None]-positions[None,:]).sum(axis=2)
        instance={'products':list(map(str,range(14))),'positions':positions.tolist(),'flow':f.tolist(),'distances':d.tolist()}
        model=self.check_all(instance,rng.permutation(14).tolist(),[(i,i+1) for i in range(0,14,2)])
        self.assertEqual(model.qubits,7);self.assertEqual(model.construction_evaluations,29)

    def test_cost_layer_phases_match_real_costs(self):
        data=preview();model=build_model(data['instance'],data['initial'],[(0,1),(2,3),(4,5),(6,7),(8,9)])
        _,h,J=model.ising();gamma=.037;qc=QuantumCircuit(5);qc.h(range(5));phase_layer(qc,h,J,gamma)
        actual=Statevector.from_instruction(qc).data
        bits=np.array([[(i>>j)&1 for j in range(5)] for i in range(32)])
        expected=np.exp(-1j*gamma*model.evaluate(bits))/np.sqrt(32)
        global_phase=actual[0]/expected[0]
        np.testing.assert_allclose(actual,global_phase*expected,atol=1e-10,rtol=0)

    def test_real_samples_decode_correctly_no_lookup_or_invalid_states(self):
        data=preview();model=build_model(data['instance'],data['initial'],[(0,1),(2,3),(4,5),(6,7),(8,9)])
        with patch('swap_qaoa.exact_model',side_effect=AssertionError('Quantum path called exact control')):
            result=sample_model(model,layers=3,shots=512,seed=15)
        self.assertEqual(sum(result['counts'].values()),512)
        validate(data['instance'],result['assignment'])
        self.assertAlmostEqual(value(data['instance'],result['assignment']),result['cost'])
        key=''.join(map(str,result['bits'][::-1]));self.assertIn(key,result['counts'])
        operations=set(result['circuit'].count_ops())
        self.assertLessEqual(operations,{'h','rz','rzz','rx','barrier','measure'})
        self.assertNotIn('diagonal',operations)
        for key in result['counts']:validate(data['instance'],model.decode([(int(key,2)>>j)&1 for j in range(5)]))
        repeat=sample_model(model,layers=3,shots=512,seed=15)
        self.assertEqual(result['counts'],repeat['counts'])

    def test_exact_control_uses_same_neighborhood(self):
        data=preview();model=build_model(data['instance'],data['initial'],[(0,1),(2,3),(4,5),(6,7),(8,9)])
        control=exact_model(model,batch_size=7)
        values=[value(data['instance'],model.decode(bits)) for bits in itertools.product([0,1],repeat=5)]
        self.assertEqual(control['cost'],min(values));self.assertEqual(control['sample_evaluations'],32)

    def test_no_angle_optimizer_no_exhaustive_quantum_model(self):
        data=preview();seen=[]
        def warm(instance,initial,*args):return {'assignment':list(initial),'cost':value(instance,initial)}
        with patch('swap_qaoa.exact_model',side_effect=AssertionError('Not allowed')):
            result=solve_swaps(data['instance'],data['initial'],warm,budget_seconds=.5,layers=2,shots=256)
        self.assertTrue(result['quantum_executed']);self.assertEqual(result['training_seconds'],0)
        self.assertEqual(result['algorithm'],'simultaneous-swaps-lr-qaoa-v1')
        for block in result['blocks']:
            self.assertLessEqual(block['seconds'],.5)
            self.assertEqual(block['construction_evaluations'],16)
            self.assertEqual(sum(block['counts'].values()),256)
            self.assertEqual(block['valid_fraction'],1)
            self.assertAlmostEqual(value(data['instance'],block['sample_assignment']),block['sample_cost'])
        self.assertLessEqual(result['cost'],data['initial_cost'])

    def test_invalid_pairing_and_bits_rejected(self):
        data=preview()
        for pairs in [[(0,1),(1,2)],[(0,0)],[(0,99)],[]]:
            with self.assertRaises(ValueError):build_model(data['instance'],data['initial'],pairs)
        model=build_model(data['instance'],data['initial'],[(0,1)])
        for bits in [[2],[],[0,1]]:
            with self.assertRaises(ValueError):model.decode(bits)


if __name__=='__main__':unittest.main()
