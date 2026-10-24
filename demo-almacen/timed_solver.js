'use strict';
const E=require('./vendor/warehouse-engine.js');let text='';process.stdin.on('data',s=>text+=s);
process.stdin.on('end',()=>{try{
 const p=JSON.parse(text),v=p.instance,i={numSkus:v.products.length,numSlots:v.positions.length,W:v.flow.map(r=>r.map(w=>w/2)),D:v.distances};
 const start=Date.now(),deadline=p.deadline_epoch*1000;let best=Int32Array.from(p.initial),bestCost=E.cost(i,best),runs=0,snapshots=0,trace=[{step:0,cost:bestCost,seconds:0}];
 const record=s=>{if(Date.now()>deadline)return false;snapshots++;if(Number.isFinite(s.bestCost)&&s.bestCost<bestCost){bestCost=s.bestCost;best=Int32Array.from(s.bestAssign);trace.push({step:snapshots,cost:bestCost,seconds:(Date.now()-start)/1000});}return !(v.optimum!=null&&bestCost<=v.optimum);};
 while(Date.now()<deadline){
  const opts={seed:p.seed+runs*104729,iterations:200000,restarts:1,start:runs===0?Int32Array.from(p.initial):E.randomAssignment(i,p.seed+runs*7919)};
  let last=null;
  if(p.method==='hybrid'){
   for(const s of E.createSolver('sa',i,opts)){last=s;if(!record(s))break;}
   if(Date.now()<deadline&&last)for(const s of E.createSolver('local',i,{start:last.bestAssign,restarts:1,seed:opts.seed})){if(!record(s))break;}
  }else{for(const s of E.createSolver(p.method,i,opts)){if(!record(s))break;}}
  runs++;if(p.method==='greedy'||(v.optimum!=null&&bestCost<=v.optimum))break;
 }
 console.log(JSON.stringify({id:p.method,label:E.SOLVERS.find(s=>s.id===p.method).name,assignment:Array.from(best),cost:bestCost,history:trace,
  start_mode:p.method==='greedy'?'constructive':'shared',initial_assignment:p.initial,runs,snapshots,seconds:(Date.now()-start)/1000,
  budget_policy:'Only incumbents completed before deadline are retained; process startup is inside the deadline.'}));
}catch(e){console.error(e.stack);process.exitCode=1;}});
