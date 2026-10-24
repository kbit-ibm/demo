"""Common instances, initial assignments and cost convention for upstream JS and Qiskit."""
from pathlib import Path
from time import perf_counter
import subprocess
import json
import hashlib
import importlib.metadata
import numpy as np
from qap10_data import load_qap10,PRODUCTS
from hybrid_solver import solve

ROOT=Path(__file__).resolve().parent
SOURCE=json.loads((ROOT/'vendor/provenance.json').read_text())
LABELS=['Agua','Jugo','Gaseosa','Café','Té','Galletas','Chocolate','Papas','Frutos secos','Barras',
    'Detergente','Lavavajillas','Desinfectante','Esponjas','Limpiavidrios','Cuadernos','Bolígrafos','Papel','Carpetas','Cinta',
    'Champú','Jabón','Pasta dental','Crema','Desodorante','Alimento perro','Alimento gato','Arena gato','Snacks mascota','Bolsas mascota']


def node(payload):
    result=subprocess.run(['node',str(ROOT/'classical_bridge.js')],input=json.dumps(payload),text=True,capture_output=True,check=True,timeout=90,cwd=ROOT)
    return json.loads(result.stdout)


def make_instance(scenario='qap10',seed=7,profile=1,density=1.):
    if scenario=='qap10':
        f,d,p=load_qap10()
        instance={'id':'qap10','title':'QAP10 · 10 productos / 10 posiciones','products':PRODUCTS,
            'flow':f.tolist(),'distances':d.tolist(),'positions':p.tolist(),'optimum':340,
            'families':['Alimentos']*10,'month':None,'source':'MIPLIB qap10 · archivo MPS oficial'}
    elif scenario=='original':
        v=node({'action':'instance','params':{'profile':profile,'density':density,'seed':seed}})
        instance={'id':'original','title':'Repositorio · 30 productos / 32 posiciones','products':LABELS,
            'flow':v['W'],'distances':v['D'],'positions':[[s['x'],s['y']] for s in v['slots']],'optimum':None,
            'families':[s['family'] for s in v['skus']],'month':v['month'],'source':'kbit-ibm/demo · instancia original',
            'generation':v['params']}
    else:raise ValueError('Instancia desconocida')
    instance['fingerprint']=hashlib.sha256(json.dumps({'F':instance['flow'],'D':instance['distances']},sort_keys=True).encode()).hexdigest()
    return instance


def value(instance,p):
    n=len(p);return float(sum(instance['flow'][i][k]*instance['distances'][p[i]][p[k]] for i in range(n) for k in range(i+1,n)))


def validate(instance,p):
    n=len(instance['products']);m=len(instance['positions'])
    if len(p)!=n or len(set(p))!=n or any(type(v) is not int or v<0 or v>=m for v in p):
        raise ValueError('Cada producto debe ocupar una ubicación distinta y válida.')


def preview(scenario='qap10',seed=7,profile=1,density=1.):
    instance=make_instance(scenario,seed,profile,density)
    initial=list(map(int,np.random.default_rng(seed).permutation(len(instance['positions']))[:len(instance['products'])]))
    return {'instance':instance,'initial':initial,'initial_cost':value(instance,initial),'source':SOURCE}


def pair_contributions(instance,initial,final):
    rows=[];n=len(initial)
    for i in range(n):
        for k in range(i+1,n):
            w=instance['flow'][i][k];before=instance['distances'][initial[i]][initial[k]];after=instance['distances'][final[i]][final[k]]
            rows.append({'i':i,'k':k,'weight':w,'before_distance':before,'after_distance':after,
                         'before_cost':w*before,'after_cost':w*after,'saving':w*(before-after)})
    return sorted(rows,key=lambda p:p['saving'],reverse=True)


def compare(config):
    start=perf_counter();data=preview(config['scenario'],config['seed'],config['profile'],config['density']);instance=data['instance']
    initial=config.get('initial') if config.get('initial') is not None else data['initial'];validate(instance,initial)
    data['initial']=initial;data['initial_cost']=value(instance,initial)
    t=perf_counter()
    results=node({'action':'solve','instance':instance,'initial':initial,'seed':config['seed'],
                  'iterations':config['sa_iterations'],'restarts':config['restarts']})
    bridge_seconds=perf_counter()-t
    quantum=solve(instance,initial,config['layers'],config['shots'],config['seed'],config['maxiter'],config['rounds'])
    results.append(quantum)
    for r in results:
        validate(instance,r['assignment']);expected=value(instance,r['assignment'])
        if abs(expected-r['cost'])>1e-7:raise ValueError(f"Costo inconsistente: {r['id']}")
        r['feasible']=True;r['improvement_percent']=100*(data['initial_cost']-r['cost'])/data['initial_cost']
        r['gap_percent']=100*(r['cost']-instance['optimum'])/instance['optimum'] if instance['optimum'] is not None else None
        r['pairs']=pair_contributions(instance,initial,r['assignment'])
    data.update({'results':results,'config':config,'total_seconds':perf_counter()-start,'classical_bridge_seconds':bridge_seconds,
        'node_version':subprocess.run(['node','--version'],capture_output=True,text=True,check=True).stdout.strip(),
        'versions':{p:importlib.metadata.version(p) for p in ['qiskit','numpy','scipy','fastapi','uvicorn']},
        'cost_convention':'sum i<k; un par una vez; motor original recibe W/2 para compensar su factor 2',
        'comparison_note':'Métodos y presupuestos distintos; tiempos locales por método, no prueba de ventaja. Greedy es constructivo; los demás reciben el mismo inicio.'})
    return data
