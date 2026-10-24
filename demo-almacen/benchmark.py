"""Multi-seed, same-wall-budget evaluation with a no-Qiskit ablation."""
import argparse
from datetime import datetime,timezone
from pathlib import Path
from statistics import mean,stdev
import json
import gzip
from comparison import preview,value,validate,SOURCE
from improved_solver import classical,improved


def benchmark(scenario='original',seeds=(7,19,42,73,101),budget_seconds=1):
    runs=[]
    for trial,seed in enumerate(seeds):
        data=preview(scenario,seed);instance=data['instance'];initial=data['initial']
        methods=['local','sa','hybrid','qiskit','ablation']
        # Rotate order to reduce systematic order/temperature bias; sequential execution, no competing solvers.
        methods=methods[trial%len(methods):]+methods[:trial%len(methods)]
        results=[]
        for method in methods:
            r=improved(instance,initial,seed,budget_seconds,ablation=method=='ablation') if method in ('qiskit','ablation') else classical(instance,initial,method,seed,budget_seconds)
            validate(instance,r['assignment']);assert abs(value(instance,r['assignment'])-r['cost'])<1e-7
            results.append(r)
        q=next(r for r in results if r['id']=='qiskit');others=[r for r in results if r['id'] not in ('qiskit','ablation')]
        best=min(r['cost'] for r in others);ab=next(r for r in results if r['id']=='ablation')
        runs.append({'seed':seed,'fingerprint':instance['fingerprint'],'initial':initial,'initial_cost':data['initial_cost'],
                     'results':results,'qiskit_minus_best_classic':q['cost']-best,'qiskit_minus_ablation':q['cost']-ab['cost']})
        print(f"{scenario} seed={seed}: "+' '.join(f"{r['id']}={r['cost']}" for r in results),flush=True)
    summary={}
    for method in ['local','sa','hybrid','qiskit','ablation']:
        rows=[next(r for r in run['results'] if r['id']==method) for run in runs];costs=[r['cost'] for r in rows]
        summary[method]={'mean_cost':mean(costs),'std_cost':stdev(costs) if len(costs)>1 else 0,
            'best_cost':min(costs),'mean_seconds':mean(r['seconds'] for r in rows)}
    return {'scenario':scenario,'seeds':list(seeds),'budget_seconds_per_method':budget_seconds,'source':SOURCE,
        'timestamp':datetime.now(timezone.utc).isoformat(),'summary':summary,'runs':runs,
        'qiskit_wins_vs_best_classic':sum(r['qiskit_minus_best_classic']<0 for r in runs),
        'qiskit_ties_vs_best_classic':sum(r['qiskit_minus_best_classic']==0 for r in runs),
        'qiskit_wins_vs_ablation':sum(r['qiskit_minus_ablation']<0 for r in runs),
        'claim':'Empirical local simulation only; no quantum advantage inferred. All seeds, including losses, retained.'}

def save_report(result,target):
    target=Path(target);target.parent.mkdir(exist_ok=True,parents=True)
    raw=target.with_suffix('.raw.json.gz')
    with gzip.open(raw,'wt',encoding='utf8') as f:json.dump(result,f,ensure_ascii=False)
    # Dashboard keeps every seed, result and quantum measurement. Repetitive classical traces are compacted.
    for run in result['runs']:
        for r in run['results']:
            if r['id']!='ablation':continue
            blocks=r['blocks'];r['block_count']=len(blocks)
            r['deadline_audit']={'all_completed_before_deadline':all(b['seconds']<=r['budget_seconds'] for b in blocks),
                                 'latest_completion_seconds':max((b['seconds'] for b in blocks),default=0)}
            r['blocks']=[b for i,b in enumerate(blocks) if b['accepted'] or i in (0,len(blocks)-1)]
            history=r['history'];r['history']=[v for i,v in enumerate(history) if i==0 or i==len(history)-1 or v['cost']<history[i-1]['cost']]
    result['raw_archive']=raw.name
    target.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--scenario',choices=['qap10','original'],default='original')
    p.add_argument('--seconds',type=float,default=1);p.add_argument('--seeds',type=int,nargs='+',default=[7,19,42,73,101]);p.add_argument('--output',default='results/fair_benchmark.json');a=p.parse_args()
    if a.seconds<.5 or a.seconds>30 or not a.seeds:raise ValueError('Use 0.5–30 seconds and at least one seed')
    result=benchmark(a.scenario,a.seeds,a.seconds);save_report(result,a.output);print(json.dumps(result['summary'],indent=2))
