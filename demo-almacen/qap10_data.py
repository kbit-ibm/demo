"""Reconstruct QAP matrices from the original MIPLIB linearized MPS, not a copy."""
from collections import defaultdict
from itertools import permutations
from pathlib import Path
from math import gcd
import gzip
import hashlib
import json
import numpy as np

ROOT=Path(__file__).resolve().parent
SOURCE_URL='https://miplib.zib.de/WebData/instances/qap10.mps.gz'
PRODUCTS=['Café','Azúcar','Arroz','Pasta','Salsa','Aceite','Leche','Galletas','Té','Harina']


def parse_columns(path=ROOT/'data/qap10.mps.gz'):
    text=gzip.open(path,'rt').read()
    columns=defaultdict(dict)
    for line in text[text.index('COLUMNS'):text.index('\nRHS')].splitlines()[1:]:
        tokens=line.split()
        if not tokens or 'MARKER' in line:continue
        name=tokens[0]
        for j in range(1,len(tokens),2):columns[name][tokens[j]]=float(tokens[j+1])
    return dict(columns)


def load_qap10():
    columns=parse_columns();tensor={}
    for name,entries in columns.items():
        if not name.startswith('Y'):continue
        # Each Y couples two assignment variables; A### identifies the X### endpoint.
        endpoints=sorted({int(row.split('A')[1])-1 for row in entries if row.startswith('C')})
        if len(endpoints)!=2:raise ValueError(f'Invalid endpoints: {name}')
        i,j=divmod(endpoints[0],10);k,l=divmod(endpoints[1],10)
        tensor[i,k,j,l]=int(entries.get('NOBJ',0))
    # Canonical factorization: gcd of coefficients for element pair (0,1) makes min positive D = 1.
    factor=gcd(*(v for (i,k,j,l),v in tensor.items() if (i,k)==(0,1)))
    distance=np.zeros((10,10),dtype=int);flow=np.zeros_like(distance)
    for (i,k,j,l),v in tensor.items():
        if (i,k)==(0,1):
            if v%factor:raise ValueError('Nonintegral distance')
            distance[j,l]=distance[l,j]=v//factor
    for (i,k,j,l),v in tensor.items():
        if distance[j,l]:
            if v%distance[j,l]:raise ValueError('Nonintegral flow')
            flow[i,k]=flow[k,i]=v//distance[j,l]
    if len(tensor)!=4050 or not all(flow[i,k]*distance[j,l]==v for (i,k,j,l),v in tensor.items()):
        raise ValueError('Factorization does not reproduce every objective coefficient')
    positions=np.array([[i%4,i//4] for i in range(10)])
    if not np.array_equal(distance,np.abs(positions[:,None,:]-positions[None,:,:]).sum(axis=2)):
        raise ValueError('Drawing coordinates do not match official distances')
    return flow,distance,positions


def validate_and_export():
    flow,distance,positions=load_qap10();columns=parse_columns()
    def value(p):return int(sum(flow[i,k]*distance[p[i],p[k]] for i in range(len(p)) for k in range(i+1,len(p))))
    controls={n:min(value(p) for p in permutations(range(n))) for n in (3,4)}
    assert controls=={3:24,4:32}
    # Independently evaluate original MPS objective AND all 1820 equality rows for 100 permutations.
    rng=np.random.default_rng(1234)
    for _ in range(100):
        p=rng.permutation(10);active_x={i*10+int(p[i]) for i in range(10)};sums=defaultdict(float)
        for name,entries in columns.items():
            if name.startswith('X'):active=int(name[1:])-1 in active_x
            else:
                ends={int(row.split('A')[1])-1 for row in entries if row.startswith('C')}
                active=ends<=active_x
            if active:
                for row,c in entries.items():sums[row]+=c
        assert sums['NOBJ']==value(p)
        assert all(sums[f'NX{i:02d}']==1 for i in range(1,21))
        assert all(v==0 for row,v in sums.items() if row.startswith('C'))
    result={'source_url':SOURCE_URL,'source_sha256':hashlib.sha256((ROOT/'data/qap10.mps.gz').read_bytes()).hexdigest(),
            'products':PRODUCTS,'flow':flow.tolist(),'distance':distance.tolist(),'positions':positions.tolist(),
            'convention':'sum i<k; each pair once; coefficients preserved without rescaling total cost',
            'factorization':'D from pair (0,1) divided by gcd=10; F recovered by division; 4050 coefficients verified',
            'controls':controls,'expected_full_optimum':340,'verified_mps_assignments':100,
            'interpretation':'Product names and co-dispatch meaning are illustrative; F is not measured probability or shipment count.'}
    (ROOT/'data/qap10.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print('OK: 4050 objective coefficients; 100 original MPS objectives/equality systems; N=3:24; N=4:32.')
    return result


if __name__=='__main__':validate_and_export()
