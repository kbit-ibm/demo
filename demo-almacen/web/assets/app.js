'use strict';
const $=id=>document.getElementById(id), fmt=(v,d=1)=>Number(v).toLocaleString('es-PE',{maximumFractionDigits:d}), pct=v=>`${fmt(v,2)} %`;
const S={data:null,result:null,pair:null,allPairs:false,manual:null,loading:false,request:0};
const fields=['scenario','seed','profile','density','layers','shots','maxiter','rounds','sa_iterations','restarts'];
function config(){return Object.fromEntries(fields.map(k=>[k,k==='scenario'?$(k).value:Number($(k).value)]));}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function status(s,type='ready'){$('status').textContent=s;$('status').dataset.state=type;}
async function api(url,options){const r=await fetch(url,options);const body=await r.json();if(!r.ok)throw Error(typeof body.detail==='string'?body.detail:'Revisa los parámetros del experimento.');return body;}
function lock(b){S.loading=b;fields.forEach(k=>$(k).disabled=b);$('run').disabled=b;document.body.classList.toggle('working',b);$('run').lastChild.textContent=b?' Calculando…':' Comparar';}
function classic(){return S.result?.results.find(r=>r.id===$('classic-method').value);}
function quantum(){return S.result?.results.find(r=>r.id==='qiskit');}
function pairRows(final){const {instance:i,initial}=S.data;const rows=[];for(let a=0;a<initial.length;a++)for(let b=a+1;b<initial.length;b++){const w=i.flow[a][b],d0=i.distances[initial[a]][initial[b]],d1=final?i.distances[final[a]][final[b]]:null;rows.push({i:a,k:b,weight:w,before_distance:d0,after_distance:d1,before_cost:w*d0,after_cost:d1===null?null:w*d1,saving:d1===null?null:w*(d0-d1)});}return rows.sort((a,b)=>(b.saving??b.weight)-(a.saving??a.weight)||a.i-b.i||a.k-b.k);}
function renderMap(id,assignment,reference,manual=false){
 if(!assignment)return;const i=S.data.instance, pos=i.positions, width=680,pad=80,cols=pos.map(p=>p[0]),ys=pos.map(p=>p[1]);
 const minX=Math.min(...cols),maxX=Math.max(...cols),minY=Math.min(...ys),maxY=Math.max(...ys);
 const scale=(width-2*pad)/Math.max(1,maxX-minX), yscale=i.id==='original'?82:120, height=2*pad+(maxY-minY)*yscale;
 const xs=[...new Set(cols)].sort((a,b)=>a-b), xstep=Math.min(...xs.slice(1).map((x,j)=>x-xs[j]));
 const cellW=Math.min(132,scale*xstep*.8),cellH=i.id==='original'?62:78;
 const point=s=>[pad+(pos[s][0]-minX)*scale,pad+(pos[s][1]-minY)*yscale];
 let html=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${id==='initial-map'?'Asignación inicial':id==='classical-map'?'Asignación clásica':'Asignación híbrida Qiskit'} de ${i.products.length} productos">`;
 if(S.pair){const [a,b]=S.pair,pa=point(assignment[a]),pb=point(assignment[b]);html+=`<line x1="${pa[0]}" y1="${pa[1]}" x2="${pb[0]}" y2="${pb[1]}" stroke="#111111" stroke-width="5" stroke-opacity=".8"/>`;}
 const occupied=new Map(assignment.map((s,product)=>[s,product]));
 for(let slot=0;slot<pos.length;slot++){
  const item=occupied.get(slot),[x,y]=point(slot),changed=item!==undefined&&reference&&reference[item]!==slot,selected=S.manual===slot&&manual;
  const fill=selected?'#cccccc':item===undefined?'#ffffff':changed?'#dedede':'#ffffff';
  const product=item===undefined?'Vacía':i.products[item],name=escapeHtml(product);
  html+=`<g class="slot" ${manual?`data-slot="${slot}" tabindex="0" role="button" aria-label="Ubicación ${slot+1}: ${name}. Seleccionar para intercambiar"`:''}><title>Ubicación ${slot+1}: ${name}</title><rect x="${x-cellW/2}" y="${y-cellH/2}" width="${cellW}" height="${cellH}" rx="7" fill="${fill}" stroke="${selected?'#111111':'#aaaaaa'}" stroke-width="${selected?3:1.4}" ${item===undefined?'stroke-dasharray="5 4"':''}/><text x="${x}" y="${y-2}" text-anchor="middle" font-size="${product.length>15?16:product.length>11?18:22}" font-weight="550" fill="#171717">${name}</text><text x="${x}" y="${y+21}" text-anchor="middle" font-size="16" fill="#666666">U${slot+1}</text></g>`;
 }
 html+='</svg>';$(id).innerHTML=html;
 if(manual)$(id).querySelectorAll('[data-slot]').forEach(node=>{const activate=()=>manualSwap(Number(node.dataset.slot));node.addEventListener('click',activate);node.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activate();}});});
}
function chart(id,r){if(!r)return;const values=r.history.map(v=>v.cost).filter(Number.isFinite);if(!values.length){$(id).textContent='El constructivo no tiene costos completos intermedios.';return;}
 let best=Infinity;const data=values.map(v=>best=Math.min(best,v)),w=600,h=190,l=65,t=15,b=35,reference=S.data.instance.optimum;
 const min=Math.min(...data,...(reference!==null?[reference]:[])),max=Math.max(...data),span=Math.max(1,max-min);
 const x=j=>l+j*(w-l-15)/Math.max(1,data.length-1),y=v=>t+(max-v)/span*(h-t-b);
 let html=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Evolución del mejor costo de ${escapeHtml(r.label)}"><text x="0" y="${t+8}" font-size="12" fill="#666666">${fmt(max)}</text><text x="0" y="${h-b}" font-size="12" fill="#666666">${fmt(min)}</text><path d="M${l} ${t}V${h-b}H${w-15}" stroke="#dddddd" fill="none"/>`;
 if(reference!==null)html+=`<line x1="${l}" x2="${w-15}" y1="${y(reference)}" y2="${y(reference)}" stroke="#111111" stroke-dasharray="5 4"/><text x="${w-95}" y="${y(reference)-5}" font-size="10" fill="#111111">Óptimo ${reference}</text>`;
 html+=`<polyline points="${data.map((v,j)=>`${x(j)},${y(v)}`).join(' ')}" fill="none" stroke="${r.id==='qiskit'?'#666666':'#171717'}" stroke-width="2.5"/><circle cx="${x(data.length-1)}" cy="${y(data.at(-1))}" r="3" fill="#171717"/><text x="${l}" y="${h-8}" font-size="11" fill="#666666">Primera instantánea</text><text x="${w-15}" y="${h-8}" text-anchor="end" font-size="11" fill="#666666">${data.length} instantáneas</text></svg>`;
 $(id).classList.remove('empty-chart');$(id).innerHTML=html;
}
function renderPairs(rebuild=false){const rows=pairRows(quantum()?.assignment),i=S.data.instance;
 if(rebuild){$('pair-select').innerHTML=rows.map(r=>`<option value="${r.i},${r.k}">${escapeHtml(i.products[r.i])} + ${escapeHtml(i.products[r.k])}</option>`).join('');S.pair=rows.length?[rows[0].i,rows[0].k]:null;}
 if(S.pair)$('pair-select').value=S.pair.join(',');
 const p=rows.find(r=>r.i===S.pair?.[0]&&r.k===S.pair?.[1]);
 if(p){$('pair-explanation').innerHTML=`<div><span>Pareja</span><strong>${escapeHtml(i.products[p.i])} + ${escapeHtml(i.products[p.k])}</strong></div><div><span>Peso</span><strong>${fmt(p.weight)}</strong></div><div><span>Costo inicial</span><strong>${fmt(p.weight)} × ${fmt(p.before_distance)} = ${fmt(p.before_cost)}</strong></div><div><span>Costo Qiskit</span><strong>${p.after_cost===null?'—':`${fmt(p.weight)} × ${fmt(p.after_distance)} = ${fmt(p.after_cost)}`}</strong></div>`;}

 $('pairs-count').textContent=`${i.products.length} productos · ${rows.length} parejas`;
 const shown=S.allPairs?rows:rows.slice(0,12);
 $('pairs-body').innerHTML=shown.map(r=>`<tr><td>${escapeHtml(i.products[r.i])}</td><td style="text-align:left">${escapeHtml(i.products[r.k])}</td><td>${fmt(r.weight)}</td><td>${fmt(r.before_distance)}</td><td>${r.after_distance===null?'—':fmt(r.after_distance)}</td><td>${fmt(r.before_cost)}</td><td>${r.after_cost===null?'—':fmt(r.after_cost)}</td><td class="${r.saving!==null&&r.saving<0?'bad':'good'}">${r.saving===null?'—':fmt(r.saving)}</td></tr>`).join('');
 $('all-pairs').textContent=S.allPairs?'Mostrar solo las primeras 12 parejas':`Mostrar las ${rows.length} parejas`;
}
function matrix(id,a,names){const max=Math.max(...a.flat(),1);$(id).innerHTML=`<table><thead><tr><th>↔</th>${names.map(n=>`<th scope="col">${escapeHtml(n)}</th>`).join('')}</tr></thead><tbody>${a.map((row,j)=>`<tr><th class="matrix-label" scope="row">${escapeHtml(names[j])}</th>${row.map(v=>`<td style="background:rgba(0,0,0,${v/max*.18})">${fmt(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;}
function initialRender(){const {instance:i,initial,initial_cost}=S.data;document.body.classList.toggle('large-instance',i.id==='original');$('initial-cost').textContent=fmt(initial_cost);$('initial-caption').textContent=`Semilla ${$('seed').value} · referencia común`;
 $('instance-note').textContent=`${i.products.length} productos · ${i.positions.length} ubicaciones · ${i.optimum!==null?'óptimo: 340':'óptimo desconocido'}`;
 $('fingerprint').textContent=`Matrices F/D · SHA256 ${i.fingerprint}`;
 document.querySelectorAll('.original-only').forEach(el=>el.hidden=i.id!=='original');
 matrix('flow-matrix',i.flow,i.products);matrix('distance-matrix',i.distances,i.positions.map((_,j)=>`U${j+1}`));
 $('month-detail').hidden=!i.month;
 if(i.month){$('month-note').textContent=`${fmt(i.month.numBaskets)} canastas simuladas con el motor original. Esta tabla registra coincidencias del mes; la función de costo usa F (no estos conteos). Ambas tablas permanecen separadas para evitar confundir sus unidades.`;matrix('month-matrix',i.month.counts,i.products);}
 renderPairs(true);renderMap('initial-map',initial,null,true);
}
function invalidate(){S.result=null;$('download').disabled=true;$('classical-cost').textContent='—';$('quantum-cost').textContent='—';
 $('classical-map').innerHTML='<div class="empty">Sin ejecutar</div>';
 $('quantum-map').innerHTML='<div class="empty">Sin ejecutar</div>';
 $('scores-body').innerHTML='<tr><td colspan="6" class="empty-cell">Sin resultados</td></tr>';
 for(const id of ['classic-chart','quantum-chart']){$(id).innerHTML='Sin ejecutar';$(id).classList.add('empty-chart');}
 $('quantum-details').hidden=true;$('circuit').textContent='Ejecuta primero una comparación.';$('classical-note').textContent='';$('quantum-note').textContent='';
}
function manualSwap(slot){if(S.loading)return;if(S.manual===null){S.manual=slot;$('manual-note').textContent=`U${slot+1} seleccionada. Elige otra ubicación para intercambiar.`;}
 else{const first=S.manual;S.manual=null;if(first!==slot){const p=S.data.initial,a=p.indexOf(first),b=p.indexOf(slot);if(a>=0)p[a]=slot;if(b>=0)p[b]=first;let c=0;for(let i=0;i<p.length;i++)for(let k=i+1;k<p.length;k++)c+=S.data.instance.flow[i][k]*S.data.instance.distances[p[i]][p[k]];S.data.initial_cost=c;invalidate();$('initial-cost').textContent=fmt(c);$('initial-caption').textContent='Estado inicial ajustado manualmente';renderPairs(true);status('Inicio modificado. Ambos enfoques recibirán esta misma distribución.');}$('manual-note').textContent='Selecciona dos posiciones para intercambiar.';}
 renderMap('initial-map',S.data.initial,null,true);
}
function resultsRender(){const c=classic(),q=quantum();$('classical-cost').textContent=fmt(c.cost);$('quantum-cost').textContent=fmt(q.cost);
 $('classical-note').textContent=`${pct(c.improvement_percent)} de mejora · ${fmt(c.seconds*1000,2)} ms de cálculo`;
 $('quantum-note').textContent=`${pct(q.improvement_percent)} de mejora · ${fmt(q.seconds,3)} s de cálculo`;
 $('scores-body').innerHTML=S.result.results.map(r=>`<tr class="${r.id==='qiskit'?'quantum-row':r.id===c.id?'selected-row':''}"><td><div class="table-label">${r.id!=='qiskit'?`<button type="button" data-method="${r.id}">${escapeHtml(r.label)}</button>`:`<strong>${escapeHtml(r.label)}</strong>`}${r.start_mode==='constructive'?'<span class="tiny">constructivo</span>':''}</div></td><td><strong>${fmt(r.cost)}</strong></td><td class="${r.improvement_percent>=0?'good':'bad'}">${pct(r.improvement_percent)}</td><td>${r.gap_percent===null?'No disponible':pct(r.gap_percent)}</td><td>${r.seconds<1?`${fmt(r.seconds*1000,2)} ms`:`${fmt(r.seconds,3)} s`}</td><td>Válida</td></tr>`).join('');
 $('scores-body').querySelectorAll('[data-method]').forEach(b=>b.addEventListener('click',()=>{$('classic-method').value=b.dataset.method;resultsRender();}));
 renderPairs(false);renderMap('initial-map',S.data.initial,null,true);renderMap('classical-map',c.assignment,S.data.initial);renderMap('quantum-map',q.assignment,S.data.initial);chart('classic-chart',c);chart('quantum-chart',q);
 $('quantum-details').hidden=false;$('quantum-details').textContent=`Qiskit · ${q.blocks.length} circuitos · ${q.qubits} qubits máx. · ${fmt(q.total_shots)} shots · ${pct(q.valid_fraction*100)} muestras locales válidas · ${q.accepted_blocks} mejoras`;
 $('circuit').textContent=q.circuit;$('download').disabled=false;
}
async function load(){const id=++S.request;lock(true);invalidate();S.manual=null;status('Cargando instancia…','running');try{const c=config(),params=new URLSearchParams({scenario:c.scenario,seed:c.seed,profile:c.profile,density:c.density});const data=await api(`/api/instance?${params}`);if(id!==S.request)return;S.data=data;initialRender();status('Instancia lista · inicio editable');}catch(e){S.data=null;status(e.message,'error');}finally{if(id===S.request)lock(false);}}
$('config').addEventListener('submit',async e=>{e.preventDefault();if(S.loading||!S.data)return;lock(true);invalidate();renderPairs(true);status('Ejecutando clásicos y Qiskit…','running');
 try{const payload={...config(),initial:S.data.initial};const submitted=await api('/api/compare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});let job;
 do{await new Promise(r=>setTimeout(r,400));job=await api(`/api/jobs/${submitted.job_id}`);}while(job.status==='running');
 if(job.status==='error')throw Error(job.error);S.result=job.result;S.data={...S.data,instance:job.result.instance,initial:job.result.initial,initial_cost:job.result.initial_cost};
 const bestPair=pairRows(quantum().assignment)[0];S.pair=[bestPair.i,bestPair.k];resultsRender();status(`Comparación terminada · ${fmt(S.result.total_seconds,2)} s`);
 }catch(e){status(`No se completó la comparación: ${e.message}`,'error');}finally{lock(false);}
});
$('classic-method').addEventListener('change',()=>{if(S.result)resultsRender();});
$('pair-select').addEventListener('change',()=>{S.pair=$('pair-select').value.split(',').map(Number);renderPairs();renderMap('initial-map',S.data.initial,null,true);if(S.result){renderMap('classical-map',classic().assignment,S.data.initial);renderMap('quantum-map',quantum().assignment,S.data.initial);}});
$('all-pairs').addEventListener('click',()=>{S.allPairs=!S.allPairs;renderPairs();});
for(const key of fields)$(key).addEventListener('change',()=>{if(['scenario','seed','profile','density'].includes(key)){S.allPairs=false;load();}else{invalidate();renderPairs(true);renderMap('initial-map',S.data.initial,null,true);status('Parámetros modificados. Ejecuta de nuevo para medir.');}$('budget').textContent=`${$('rounds').value} rondas QAOA · ${fmt($('sa_iterations').value,0)} pasos de recocido`;});
$('download').addEventListener('click',()=>{if(!S.result)return;const blob=new Blob([JSON.stringify(S.result,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`kbit-${S.result.instance.id}-semilla-${S.result.config.seed}.json`;a.click();URL.revokeObjectURL(url);});
load();

for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>{document.querySelectorAll('.view').forEach(v=>v.hidden=v.id!==button.dataset.view);document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});});
