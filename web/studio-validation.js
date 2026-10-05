const el=id=>document.getElementById(id),key=location.hash.slice(1);
el('auth-bridge').href='/#'+key;
if(!/^[a-f0-9]{64}$/.test(key))el('instruction').textContent='请用 controller 输出的配对 URL 打开此页（路径 /studio-validation，保留 # 后配对码）。';
const api=async(action,body)=>{const r=await fetch('/api/studio-validation/'+action,{method:body?'POST':'GET',headers:{'X-Controller-Key':key,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const v=await r.json();if(!r.ok)throw Error(v.error?.message??'local controller failed');return v;};
let busy=false;
async function poll(){if(!key)return;window.dispatchEvent(new CustomEvent('studio-validation-pair',{detail:{base:location.origin,key}}));
  try{const s=await api('status');el('status').textContent=JSON.stringify(s,null,2);el('instruction').textContent=s.active?(s.armed&&s.active.phase==='CAPTURING'?'现在只执行：'+s.scenarios[s.active.scenario]:'等待 recorder 确认控制状态；暂不执行 UI 动作'):'请选择一个动作并 Begin；不要同时修改多个属性';
    if(s.active){el('run').value=s.active.runId;el('project').value=s.active.projectId??el('project').value;el('scenario').value=s.active.scenario;}
    el('scenario').disabled=!!s.active;el('begin').disabled=busy||!!s.active;el('end').disabled=busy||!s.active;}
  catch(e){el('status').textContent=e.message;}}
for(const action of ['begin','end','report','export'])el(action).addEventListener('click',async()=>{
  if(busy)return;busy=true;try{const body={runId:el('run').value||undefined,scenario:el('scenario').value,projectId:el('project').value||undefined};
    if(action==='begin'&&el('prediction').files[0])body.prediction=JSON.parse(await el('prediction').files[0].text());
    const v=await api(action,body);el('result').textContent=JSON.stringify(v,null,2);
    if(v.runId)el('run').value=v.runId;
    if(action==='end'&&v.report?.projectId)el('project').value=v.report.projectId;
    if(action==='end'){const analysis=await api('analyze-run',{runId:v.runId});el('result').textContent=JSON.stringify({scenarioResult:v,runAnalysis:analysis},null,2);}
    if(action==='export'){const blob=new Blob([JSON.stringify(v,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=body.scenario+'-evidence.json';link.click();URL.revokeObjectURL(url);}}
  catch(e){el('result').textContent=e.message;}finally{busy=false;void poll();}});
setInterval(()=>{void poll();},1000);void poll();
