"""Deadline-bounded classical warm start + simultaneous-swap LR-QAOA.

A classical-exact ablation uses the SAME neighborhood family, without a quantum circuit.
Any speed/quality gain of the complete hybrid is not attributed automatically to Qiskit.
"""
from time import perf_counter,time
import json
import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parent


def classical(instance,initial,method,seed,budget_seconds):
    started=perf_counter();deadline=time()+budget_seconds
    p=subprocess.run(['node',str(ROOT/'timed_solver.js')],input=json.dumps({'instance':instance,'initial':initial,'method':method,'seed':seed,'deadline_epoch':deadline}),text=True,capture_output=True,check=True,timeout=budget_seconds+10,cwd=ROOT)
    r=json.loads(p.stdout);r['seconds']=perf_counter()-started;r['budget_seconds']=budget_seconds
    return r


def improved(instance,initial,seed=7,budget_seconds=1,layers=2,shots=1024,maxiter=40,ablation=False,
             max_swaps=12,delta_beta=.75,delta_gamma=.75):
    """Compatibility entry point. maxiter is retained but unused: no angle training."""
    from swap_qaoa import solve_swaps
    result=solve_swaps(instance,initial,classical,seed,budget_seconds,layers,shots,ablation,
                       max_swaps,delta_beta,delta_gamma)
    result['options']['ignored_legacy_maxiter']=maxiter
    return result
