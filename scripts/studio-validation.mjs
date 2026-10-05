import {readFile}from'node:fs/promises';
import {SunoBridge}from'../suno/bridge/client.mjs';
const [action='status',...rest]=process.argv.slice(2),scenario=rest[0]&&!rest[0].startsWith('--')?rest.shift():undefined,args=rest,options={};
for(let i=0;i<args.length;i+=2){const key=args[i];if(!['--project-id','--run-id','--prediction'].includes(key)||!args[i+1])throw Error('unknown or incomplete CLI option');options[key]=args[i+1];}
if(!['status','begin','end','report','export','analyze-run'].includes(action))throw Error('usage: studio-validation status|begin|end|report|export [A_CREATE..H_EXPORT] [--project-id ID] [--run-id ID] [--prediction file.json]');
const bridge=new SunoBridge({base:process.env.SUNO_CONTROLLER_BASE??'http://127.0.0.1:3000'});
const path='/api/studio-validation/'+action,body={scenario,projectId:options['--project-id'],runId:options['--run-id'],...(options['--prediction']?{prediction:JSON.parse(await readFile(options['--prediction'],'utf8'))}:{})};
let result;if(action==='status'){const r=await fetch(bridge.base+path,{headers:{'X-Controller-Key':bridge.key}});result=await r.json();if(!r.ok)throw Error('local status request rejected');}else result=await bridge.request(path,body);
if(action==='end')result={...result,runAnalysis:await bridge.request('/api/studio-validation/analyze-run',{runId:result.runId})};
console.log(JSON.stringify(result,null,2));
