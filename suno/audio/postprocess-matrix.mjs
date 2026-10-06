import { SunoBridge } from '../bridge/client.mjs';
import { StudioClient } from '../studio/operations.mjs';
import { controlledStateReadback } from './postprocessing-validation.mjs';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { syntheticReference } from './transform-verification.mjs';
import { wav, ffmpeg } from './pcm.mjs';
import { parseConfig } from './config.mjs';
import { durableJson } from '../../shared/durable-json.mjs';
export async function runPostprocessMatrix(directory,runPipeline,{keep=false,diagnose=false,dryRun=false,jsonLog=false,bridge:sharedBridge}={}) {
  await mkdir(directory,{recursive:true});const source=join(directory,'synthetic-reference.wav');await writeFile(source,wav(syntheticReference()));
  const variants=[
    ['BASELINE_STRETCH_OFF',0,1,'off'],['PITCH_ONLY',-8,1,'on'],['SPEED_ONLY',0,.5,'on'],['STRETCH_ONLY',0,1,'on'],
    ['PITCH_STRETCH',-8,1,'on'],['SPEED_STRETCH',0,.5,'on'],['PITCH_SPEED_STRETCH',-8,.5,'on'],
    ['FULL_TARGET',-8,.5,'on'],['VOLUME_INVERSE',0,1,'on',.5],['FORMANT_NONNEUTRAL',0,1,'on',1,.5],['FORMANT_PITCH',-8,1,'on',1,.5]
  ];
  const report={schemaVersion:1,uiMapping:'NOT VERIFIED',source,experiments:[],failures:[],noCatalogSource:true};
  for(const [mode,pitch,speed,stretch,volume=1,formant=0] of variants){
    const runDir=join(directory,mode);await mkdir(runDir,{recursive:true});
    const config=parseConfig([source,...(jsonLog?['--json-log']:[]),...(dryRun?['--dry-run']:[]),...(keep?['--keep-workdir']:[]),...(diagnose?['--diagnose']:[]),'--studio-pitch',String(pitch),'--studio-speed',String(speed),'--studio-stretch',stretch,'--studio-volume',String(volume),'--studio-formant',String(formant),'--strategy','exact','--validate-transform','--synthetic-reference']);
    const {access}=await import('node:fs/promises');if(!await access(join(runDir,'config.json')).then(()=>true,()=>false))await durableJson(join(runDir,'config.json'),config);
    try{const result=await runPipeline({...config,resume:runDir});report.experiments.push({...result,mode});}
    catch(e){report.failures.push({mode,message:e.message,status:e.status});}
    await durableJson(join(directory,'postprocess-matrix.json'),report);
  }
  // Controlled candidates distinguish rate (changes pitch) from pitch-preserving tempo.
  for(const kind of ['RATE_X2','ATEMPO_X2']){
    const candidate=join(directory,kind+'.wav'),runDir=join(directory,kind);await mkdir(runDir,{recursive:true});
    await ffmpeg(['-y','-i',source,'-af',kind==='RATE_X2'?'asetrate=96000,aresample=48000':'atempo=2','-c:a','pcm_f32le',candidate]);
    const config=parseConfig([source,...(jsonLog?['--json-log']:[]),...(dryRun?['--dry-run']:[]),...(keep?['--keep-workdir']:[]),...(diagnose?['--diagnose']:[]),'--studio-pitch','0','--studio-speed','0.5','--preprocessed',candidate,'--strategy','exact','--validate-transform','--synthetic-reference']);
    const {access}=await import('node:fs/promises');if(!await access(join(runDir,'config.json')).then(()=>true,()=>false))await durableJson(join(runDir,'config.json'),config);
    try{report.experiments.push({...await runPipeline({...config,resume:runDir}),mode:kind});}catch(e){report.failures.push({mode:kind,message:e.message});}
    await durableJson(join(directory,'postprocess-matrix.json'),report);
  }
  const mappingFile=join(directory,'api-state-mapping.json');
  if(!dryRun&&!await readFile(mappingFile).then(()=>true,()=>false)&&report.experiments.length){
    const bridge=sharedBridge??new SunoBridge({base:process.env.SUNO_CONTROLLER_BASE,allow_verified_studio_writes:true}),client=new StudioClient(bridge,{allow_verified_studio_writes:true});
    const wire=JSON.parse(await readFile(join(report.experiments[0].work,'PRODUCTION','studio-state-before-save.json')));
    report.apiMapping=await controlledStateReadback(client,wire,mappingFile);
  }
  await durableJson(join(directory,'postprocess-matrix.json'),report);
  if(!keep&&!diagnose&&!report.failures.length)for(const file of [source,join(directory,'RATE_X2.wav'),join(directory,'ATEMPO_X2.wav')])await rm(file,{force:true});
  report.networkWrites=dryRun?0:undefined;
  report.classification=dryRun?'DRY_RUN':report.failures.length?'INCOMPLETE':report.experiments.some(e=>e.transformVerification?.classification!=='PASS')?'WARN':'PASS';
  await durableJson(join(directory,'postprocess-matrix.json'),report);
  return report;
}
