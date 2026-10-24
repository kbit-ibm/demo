'use strict';
const E=require('./vendor/warehouse-engine.js');
const {performance}=require('node:perf_hooks');
let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>input+=s);
process.stdin.on('end',()=>{try{
 const p=JSON.parse(input);
 if(p.action==='instance'){
  const i=E.buildInstance(p.params);
  const month=E.simulateMonth(i,{seed:p.params.seed});
  console.log(JSON.stringify({...i,W:i.W.map(r=>Array.from(r)),D:i.D.map(r=>Array.from(r)),
    month:{numBaskets:month.numBaskets,counts:month.counts.map(r=>Array.from(r))}}));return;
 }
 const v=p.instance;
 // Original engine returns 2 * sum(i<k) W D. Halving W preserves all solver/delta semantics.
 const i={numSkus:v.products.length,numSlots:v.positions.length,
   W:v.flow.map(row=>Float64Array.from(row,w=>w/2)),D:v.distances.map(row=>Float64Array.from(row))};
 const opts={start:p.initial,seed:p.seed,iterations:p.iterations,restarts:p.restarts};
 const results=[];
 for(const id of ['greedy','local','sa','hybrid']){
  const t=performance.now();let last=null;let trace=[];
  const record=s=>{last=s;if(Number.isFinite(s.bestCost))trace.push({step:s.iter,cost:s.bestCost});};
  if(id==='hybrid'){
   // Upstream hybrid drops opts.start; compose its exact two stages while forwarding the common start.
   for(const s of E.createSolver('sa',i,opts))record(s);
   for(const s of E.createSolver('local',i,{start:last.bestAssign,restarts:1,seed:p.seed}))record(s);
  }else{for(const s of E.createSolver(id,i,opts))record(s);}
  const seconds=(performance.now()-t)/1000;
  const assignment=Array.from(last.bestAssign),value=E.cost(i,assignment);
  results.push({id,label:E.SOLVERS.find(s=>s.id===id).name,assignment,cost:value,seconds,
    history:trace,start_mode:id==='greedy'?'constructive':'shared',initial_assignment:id==='greedy'?null:p.initial,
    options:{seed:p.seed,iterations:p.iterations,restarts:id==='hybrid'?1:p.restarts}});
 }
 console.log(JSON.stringify(results));
}catch(error){console.error(error.stack);process.exitCode=1;}});
