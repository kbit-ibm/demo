"""Unified local comparison UI. No Gradio and no simulated/fabricated results."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Literal
from threading import Lock
import json
import uuid
from fastapi import FastAPI,HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel,Field,ConfigDict
from comparison import preview,compare,ROOT

class Settings(BaseModel):
    model_config=ConfigDict(extra='forbid')
    scenario:Literal['qap10','original']='qap10'
    seed:int=Field(default=7,ge=0,le=2147483647)
    profile:int=Field(default=1,ge=1,le=5)
    density:float=Field(default=1,ge=.5,le=1)
    layers:int=Field(default=2,ge=1,le=3)
    shots:int=Field(default=1024,ge=256,le=4096)
    maxiter:int=Field(default=40,ge=10,le=100)
    rounds:int=Field(default=2,ge=1,le=5)
    sa_iterations:int=Field(default=50000,ge=1000,le=200000)
    restarts:int=Field(default=8,ge=1,le=16)
    initial:list[int]|None=None

app=FastAPI(title='Kbit · Laboratorio de asignación')
executor=ThreadPoolExecutor(max_workers=1);jobs={};guard=Lock()

@app.get('/api/health')
def health():return {'status':'ok'}

@app.get('/api/instance')
def instance(scenario:Literal['qap10','original']='qap10',seed:int=7,profile:int=1,density:float=1):
    try:
        c=Settings(scenario=scenario,seed=seed,profile=profile,density=density)
        return preview(c.scenario,c.seed,c.profile,c.density)
    except ValueError as e:raise HTTPException(422,str(e))


def perform(job_id,config):
    try:
        result=compare(config)
        with guard:jobs[job_id]={'status':'complete','result':result}
        target=ROOT/'results'/'unified_latest.json';target.parent.mkdir(exist_ok=True)
        tmp=target.with_suffix('.tmp');tmp.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');tmp.replace(target)
    except Exception as e:
        with guard:jobs[job_id]={'status':'error','error':str(e)}

@app.post('/api/compare',status_code=202)
def comparison(config:Settings):
    with guard:
        if any(j['status']=='running' for j in jobs.values()):raise HTTPException(409,'Hay una comparación en ejecución. Espera a que termine.')
        job_id=uuid.uuid4().hex;jobs[job_id]={'status':'running'}
        while len(jobs)>20:jobs.pop(next(iter(jobs)))
    executor.submit(perform,job_id,config.model_dump())
    return {'job_id':job_id,'status':'running'}

@app.get('/api/jobs/{job_id}')
def job(job_id:str):
    with guard:
        if job_id not in jobs:raise HTTPException(404,'Ejecución no encontrada')
        return jobs[job_id]

@app.get('/')
def home():return FileResponse(ROOT/'web'/'index.html')

app.mount('/assets',StaticFiles(directory=ROOT/'web'/'assets'),name='assets')

if __name__=='__main__':
    import uvicorn
    uvicorn.run(app,host='127.0.0.1',port=7860)
