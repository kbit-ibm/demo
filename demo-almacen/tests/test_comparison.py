"""Cross-language cost parity, source fidelity and actual sampled Qiskit runs."""
import hashlib
from itertools import permutations
import json
from pathlib import Path
import subprocess
import unittest
import numpy as np
from comparison import preview,compare,value,validate,ROOT,SOURCE,pair_contributions
from hybrid_solver import solve
from qap10_data import load_qap10

class ComparisonTests(unittest.TestCase):
    def test_upstream_engine_is_unmodified(self):
        self.assertEqual(hashlib.sha256((ROOT/'vendor/warehouse-engine.js').read_bytes()).hexdigest(),SOURCE['sha256'])
        if (ROOT/'classical-source/engine.js').exists():
            self.assertEqual((ROOT/'classical-source/engine.js').read_bytes(),(ROOT/'vendor/warehouse-engine.js').read_bytes())

    def test_mps_control_values_and_coordinates(self):
        f,d,pos=load_qap10()
        for n,expected in [(3,24),(4,32)]:
            best=min(sum(f[i,k]*d[p[i],p[k]] for i in range(n) for k in range(i+1,n)) for p in permutations(range(n)))
            self.assertEqual(best,expected)
        np.testing.assert_array_equal(d,np.abs(pos[:,None,:]-pos[None,:,:]).sum(axis=2))

    def test_full_qap10_optimum(self):
        from track_b import exact_reference
        assignment,c,_,evaluated=exact_reference()
        self.assertEqual(c,340);self.assertEqual(evaluated,3628800)
        self.assertEqual(value(preview()['instance'],assignment),340)

    def test_original_generation_and_density(self):
        full=preview('original',7,1,1)['instance'];sparse=preview('original',7,1,.5)['instance']
        self.assertEqual(len(full['products']),30);self.assertEqual(len(full['positions']),32)
        self.assertEqual(len(full['month']['counts']),30)
        self.assertEqual(sum(w>0 for row in sparse['flow'] for w in row),2*round(.5*435))
        self.assertEqual(full['distances'],sparse['distances'])

    def test_js_cost_and_deltas_match_python(self):
        code="""const E=require('./vendor/warehouse-engine.js');let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{
        const v=JSON.parse(s),i={numSkus:v.products.length,numSlots:v.positions.length,W:v.flow.map(r=>r.map(x=>x/2)),D:v.distances};
        const out=[];for(let trial=1;trial<=40;trial++){const p=Array.from(E.randomAssignment(i,trial));
        const a=trial%i.numSkus,b=(a+1)%i.numSkus,q=p.slice();[q[a],q[b]]=[q[b],q[a]];
        out.push({p,c:E.cost(i,p),q,d:E.deltaSwap(i,p,a,b)});
        const empty=Array.from({length:i.numSlots},(_,j)=>j).find(s=>!p.includes(s));
        if(empty!==undefined){const z=p.slice();z[a]=empty;out.push({p,c:E.cost(i,p),q:z,d:E.deltaMove(i,p,a,empty)});}}
        console.log(JSON.stringify(out));});"""
        for scenario in ['qap10','original']:
            instance=preview(scenario)['instance']
            out=subprocess.run(['node','-e',code],input=json.dumps(instance),text=True,capture_output=True,check=True,cwd=ROOT)
            for row in json.loads(out.stdout):
                self.assertAlmostEqual(value(instance,row['p']),row['c'])
                self.assertAlmostEqual(value(instance,row['q'])-row['c'],row['d'])

    def test_quantum_samples_and_same_start(self):
        for scenario in ['qap10','original']:
            data=preview(scenario);instance=data['instance'];p=data['initial']
            a=solve(instance,p,layers=1,shots=256,seed=7,maxiter=10,rounds=1)
            b=solve(instance,p,layers=1,shots=256,seed=7,maxiter=10,rounds=1)
            self.assertEqual(a['assignment'],b['assignment']);self.assertEqual(a['blocks'][0]['counts'],b['blocks'][0]['counts'])
            self.assertEqual(a['blocks'][0]['assignment_before'],p)
            self.assertLessEqual(a['cost'],data['initial_cost']);validate(instance,a['assignment'])
            for block in a['blocks']:
                self.assertEqual(sum(block['counts'].values()),256)
                self.assertAlmostEqual(value(instance,block['assignment_after']),block['after'])
                self.assertLessEqual(block['after'],block['before'])
                if scenario=='original':self.assertIsNotNone(block['empty_slot_offered'])
            pairs=pair_contributions(instance,p,a['assignment'])
            self.assertAlmostEqual(sum(r['before_cost'] for r in pairs),data['initial_cost'])
            self.assertAlmostEqual(sum(r['after_cost'] for r in pairs),a['cost'])

    def test_shared_manual_start_all_results_and_reference_labels(self):
        for scenario in ['qap10','original']:
            data=preview(scenario);p=data['initial'];p[0],p[1]=p[1],p[0]
            r=compare(dict(scenario=scenario,seed=7,profile=1,density=1,layers=1,shots=256,maxiter=10,rounds=1,sa_iterations=1000,restarts=1,initial=p))
            self.assertEqual(r['initial'],p)
            self.assertEqual(len(r['results']),5)
            for method in r['results']:
                validate(r['instance'],method['assignment']);self.assertAlmostEqual(value(r['instance'],method['assignment']),method['cost'])
                self.assertEqual(method['start_mode'],'constructive' if method['id']=='greedy' else 'shared')
                self.assertEqual(method['gap_percent'] is None,scenario=='original')
                if method['id'] not in ('greedy','qiskit'):self.assertEqual(method['initial_assignment'],p)

    def test_improved_budget_sampling_and_ablation(self):
        from improved_solver import improved,classical
        instance=preview('original')['instance'];initial=preview('original')['initial']
        q=improved(instance,initial,seed=7,budget_seconds=.7,layers=1,shots=256,maxiter=10)
        a=improved(instance,initial,seed=7,budget_seconds=.7,ablation=True)
        for r in [q,a]:
            validate(instance,r['assignment']);self.assertAlmostEqual(value(instance,r['assignment']),r['cost'])
            self.assertLessEqual(r['cost'],r['warm_start_cost'])
            for block in r['blocks']:
                self.assertLessEqual(block['seconds'],r['budget_seconds'])
                self.assertAlmostEqual(value(instance,block['assignment_after']),block['after'])
        self.assertTrue(q['quantum_executed']);self.assertGreater(q['total_shots'],0)
        for b in q['blocks']:self.assertEqual(sum(b['counts'].values()),256)
        self.assertFalse(a['quantum_executed']);self.assertEqual(a['total_shots'],0)
        self.assertEqual(q['qiskit_additional_gain'],q['warm_start_cost']-q['cost'])
        c=classical(instance,initial,'hybrid',7,.5)
        self.assertEqual(c['initial_assignment'],initial);validate(instance,c['assignment'])

    def test_invalid_assignment_rejected(self):
        instance=preview()['instance']
        for p in [[0]*10,list(range(9)),list(range(1,11))]:
            with self.assertRaises(ValueError):validate(instance,p)

if __name__=='__main__':unittest.main()
