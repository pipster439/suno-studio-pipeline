import{readFile,writeFile,mkdir,rm,copyFile}from'node:fs/promises';
import{resolve,join,dirname,extname}from'node:path';
import{execFile}from'node:child_process';import{promisify}from'node:util';
import{probe,decode,readPCM,wav,verifyAlignment,sample,ffmpeg,sha256}from'./pcm.mjs';
import{analyzeBoundaries,analyzeMeasurements,measureBoundary,normalProbeTimes,qualityGate,silentGaps,windowMetrics,writeAnalysis}from'./boundaries.mjs';
import{QUALITY_THRESHOLDS,classifyGaps,summarizeQuality}from'./quality.mjs';
import{retry429,retryS3Transfer,boundedMap}from'./upload.mjs';
const execute=promisify(execFile);
export function trustedDeliveryURL(value) {const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||!/(?:\.amazonaws\.com|\.suno\.ai|\.suno\.com|\.cloudfront\.net)$/.test(u.hostname))throw Error('Unexpected official delivery destination');return u;}
export async function downloadDelivery(url,file,{fetchImpl=fetch,log=async()=>{}}={}) {
  trustedDeliveryURL(url);await mkdir(dirname(file),{recursive:true});
  await retryS3Transfer(async()=>{const res=await retry429(async()=>{const r=await fetchImpl(url,{signal:AbortSignal.timeout(120000)});if(!r.ok){const e=Error(`Delivery HTTP ${r.status}`);e.status=r.status;e.retryAfter=r.headers.get('retry-after');throw e;}return r;},{log});const bytes=Buffer.from(await res.arrayBuffer());if(bytes.length<128)throw Error('Empty delivery');await writeFile(file,bytes);},{log});return file;
}
export async function remoteWindow(url,start,end,file) {
  // copyts exposes original PTS. -to is absolute when copyts is used; -t would
  // produce empty output after a nonzero input seek on this FFmpeg build.
  const {stderr}=await execute(process.env.FFMPEG||'ffmpeg',['-hide_banner','-loglevel','verbose','-rw_timeout','20000000','-copyts','-ss',String(start),'-i',url,'-to',String(end),'-af','ashowinfo','-map','0:a:0','-vn','-c:a','pcm_f32le','-y',file],{timeout:45000,maxBuffer:3*1024*1024});
  const first=/n:0 pts:(-?\d+) pts_time:([-\d.]+).*?rate:(\d+)/.exec(stderr);if(!first)throw Error('Decoded window has no validated source PTS');
  const pcm=readPCM(await readFile(file)),originSeconds=Number(first[1])/Number(first[3]);
  if(Math.abs(originSeconds-start)>2/pcm.sampleRate)throw Error('Seek PTS does not match expanded decode range');
  const bytesRead=[...stderr.matchAll(/Statistics: (\d+) bytes read/g)].reduce((n,m)=>n+Number(m[1]),0);
  return{pcm,originSeconds,bytesRead,requestedStart:start,requestedEnd:end};
}
export function cropProbe(window,timestamp,radius=.5) {
  const {pcm,originSeconds}=window,center=Math.round((timestamp-originSeconds)*pcm.sampleRate),span=Math.round(radius*pcm.sampleRate);
  if(center-span<0||center+span>pcm.frames)throw Error('Expanded remote decode does not cover the complete boundary window');
  return{pcm:readPCM(wav(pcm,center-span,center+span)),timestamp,centerSec:span/pcm.sampleRate,originSeconds:timestamp-span/pcm.sampleRate};
}
function groupsFor(times,duration) {
  const groups=[];for(const t of [...times].sort((a,b)=>a-b)){const a=Math.max(0,t-.75),z=Math.min(duration,t+.75),last=groups.at(-1);if(last&&a<=last.end){last.end=Math.max(z,last.end);last.times.push(t);}else groups.push({start:a,end:z,times:[t]});}return groups;
}
function globalMeasure(window,timestamp) {const p=cropProbe(window,timestamp),m=measureBoundary(p.pcm,p.centerSec),offset=Math.round(p.originSeconds*p.pcm.sampleRate);m.timestamp=timestamp;m.sample=Math.round(timestamp*p.pcm.sampleRate);for(const w of Object.values(m.windows)){w.startSample+=offset;w.endSample+=offset;}return m;}
export async function qualityFromDelivery({url,directory,times,expectedDuration,metadataDuration,sourcePCM,sourceOffsetSeconds=0,timelineGapSamples=0,keep=false,diagnose=false,localAnalysis=false},deps={}) {
  const started=performance.now(),qaDir=join(directory,'qa');await mkdir(qaDir,{recursive:true});
  await mkdir(join(directory,'diagnostics'),{recursive:true});
  trustedDeliveryURL(url);let info=null,duration=expectedDuration;
  const fetchImpl=deps.fetch??fetch,decodeWindow=deps.window??remoteWindow;
  let analysis,pcm=null,deliveryFile=null,decodedFile=null,mode='FULL_TEMP_FALLBACK',fallbackReason=null,capabilities={};
  try {
    info=await(deps.probe??probe)(url);duration=info.duration;
    const range=await fetchImpl(url,{headers:{Range:'bytes=0-0'},signal:AbortSignal.timeout(20000)});capabilities={httpRange:range.status===206&&/^bytes 0-0\/\d+$/.test(range.headers.get('content-range')??''),responseStatus:range.status,totalBytes:Number((range.headers.get('content-range')??'').split('/')[1]||range.headers.get('content-length'))||null};await range.body?.cancel();
    if(!times.length||duration<2||localAnalysis)throw Error('Local full QA needed for no-boundary or explicit PCM diagnostics');
    const validationTime=times[0],first=await decodeWindow(url,Math.max(0,validationTime-.75),Math.min(duration,validationTime+.75),join(qaDir,'validation-a.wav'));
    const second=await decodeWindow(url,Math.max(0,validationTime-1.05),Math.min(duration,validationTime+.75),join(qaDir,'validation-b.wav'));
    const a=cropProbe(first,validationTime),b=cropProbe(second,validationTime),alignment=verifyAlignment(a.pcm,b.pcm,[.5],{maxLagMs:5,toleranceMs:1/info.sampleRate*1000});
    capabilities.seekAlignment=alignment;capabilities.firstSourcePTS=first.originSeconds;capabilities.validationBytesRead=first.bytesRead+second.bytesRead;
    if(!alignment.passed||alignment.checks.some(c=>c.correlation<.9999))throw Error('Independent expanded remote seeks disagree at sample center');
    if(!capabilities.httpRange&&(!first.bytesRead||!capabilities.totalBytes||first.bytesRead>capabilities.totalBytes*.5))throw Error('Non-range seek reads too much of the asset');
    const normals=normalProbeTimes(duration,times,{baselineCount:QUALITY_THRESHOLDS.baselineCount}),groups=groupsFor([...times,...normals],duration),coverage=groups.reduce((n,g)=>n+g.end-g.start,0),limits=deps.costLimits??{maxGroups:64,maxCoverage:.65};
    capabilities.estimatedDecodeSeconds=coverage;capabilities.probeGroupCount=groups.length;
    if(groups.length>limits.maxGroups||coverage>duration*limits.maxCoverage)throw Error('Normal controls plus boundary requests cost more than one temporary decode');
    const measured=new Map();let sampledGaps=[];
    await boundedMap(groups,2,async(g,index)=>{const w=await decodeWindow(url,g.start,g.end,join(qaDir,`group-${index}.wav`));for(const t of g.times)measured.set(t,globalMeasure(w,t));sampledGaps.push(...silentGaps(w.pcm).map(s=>({start:s.start+w.originSeconds,end:s.end+w.originSeconds})));if(diagnose)for(const t of g.times.filter(t=>times.includes(t))){const p=cropProbe(w,t);await writeFile(join(directory,'diagnostics',`boundary_${String(times.indexOf(t)).padStart(3,'0')}.wav`),wav(p.pcm));}});
    analysis=analyzeMeasurements(times.map(t=>measured.get(t)),normals.map(t=>measured.get(t)),{duration,sampleRate:info.sampleRate,channels:info.channels});mode=capabilities.httpRange?'RANGE':'SEEK';capabilities.sampledGaps=sampledGaps;
    if(analysis.baselineCount<QUALITY_THRESHOLDS.minimumActiveBaseline)throw Error('Insufficient active remote normal controls');
  }catch(e){fallbackReason=e.message;mode='FULL_TEMP_FALLBACK';}
  if(mode==='FULL_TEMP_FALLBACK'){
    deliveryFile=join(qaDir,'delivery.m4a');decodedFile=join(qaDir,'decoded.wav');
    await(deps.download??downloadDelivery)(url,deliveryFile,{fetchImpl,log:deps.log});pcm=await(deps.decode??decode)(deliveryFile,decodedFile);info??=await(deps.probe??probe)(deliveryFile);analysis=analyzeBoundaries(pcm,times,{baselineCount:QUALITY_THRESHOLDS.baselineCount});
  }
  analysis.responseValidated=true;const gate=qualityGate(analysis,expectedDuration,metadataDuration,{codecTailToleranceMs:QUALITY_THRESHOLDS.codecTailToleranceMs}),sourceRmsAt=g=>{if(!sourcePCM)return 0;const center=Math.round(((g.start+g.end)/2+sourceOffsetSeconds)*sourcePCM.sampleRate),radius=Math.max(1,Math.round((g.end-g.start)/2*sourcePCM.sampleRate));return Math.max(...windowMetrics(sourcePCM,center,radius).channels.map(c=>c.rms));};
  const gaps=classifyGaps(pcm?silentGaps(pcm):capabilities.sampledGaps??[],analysis.duration,sourceRmsAt);gate.silentGaps=gaps;
  for(const g of gaps.filter(g=>g.kind==='INTERNAL'&&g.unexpected&&g.end-g.start>.05))gate.warnings.push({metric:'unexpected_silent_gap',timestamp:g.start,severity:'warning',duration:g.end-g.start});
  if(times.length&&analysis.baselineCount<QUALITY_THRESHOLDS.minimumActiveBaseline)gate.warnings.push({metric:'insufficient_active_controls',severity:'warning'});
  if(analysis.averageBoundaryScore>QUALITY_THRESHOLDS.averageScore||analysis.maxBoundaryScore>QUALITY_THRESHOLDS.maxScore)gate.warnings.push({metric:'score_guard',severity:'warning',averageScore:analysis.averageBoundaryScore,maxScore:analysis.maxBoundaryScore});
  if(gate.warnings.length)gate.status='QUALITY WARNING';
  const summary={...summarizeQuality(analysis,gate,timelineGapSamples,gaps),remoteProbeMode:mode,capabilities,fallbackReason,deliveryInfo:info,qualityProbeMs:performance.now()-started,silenceCoverage:pcm?'ALL_PCM':'BOUNDARY_AND_CONTROL_WINDOWS'};
  await writeAnalysis(join(directory,'diagnostics'),analysis,pcm,diagnose&&!!pcm);
  if(!keep&&!diagnose&&!localAnalysis&&gate.status==='PASS'){const absolute=resolve(qaDir);if(!absolute.startsWith(resolve(directory)+'\\')&&!absolute.startsWith(resolve(directory)+'/'))throw Error('QA cleanup escaped workspace');await rm(qaDir,{recursive:true,force:true});deliveryFile=null;decodedFile=null;}
  return{analysis,gate,qualitySummary:summary,deliveryFile,decodedFile,pcm};
}
export async function saveDeliveryAsset(url,output,temporaryDelivery,{download=downloadDelivery,convert=ffmpeg,deliveryInfo,inspect=probe}={}) {
  await mkdir(dirname(output),{recursive:true});const extension=extname(output).toLowerCase(),native=extension==='.m4a'||extension==='.mp4';
  let input=temporaryDelivery,owned=false,sourceInfo=deliveryInfo;
  if(native){if(input)await copyFile(input,output);else await download(url,output);}
  else{if(!input){input=output+'.source.m4a';owned=true;await download(url,input);}try{sourceInfo??=await inspect(input);await convert(['-y','-i',input,'-map','0:a:0','-vn',...(extension==='.wav'?['-c:a','pcm_f32le']:extension==='.mp3'?['-c:a','libmp3lame','-q:a','2']:['-c:a','flac']),output]);}finally{if(owned)await rm(input,{force:true});}}
  sourceInfo??=await inspect(output);
  return{output:resolve(output),sourceDeliveryFormat:`${sourceInfo.formatName??'official-m4a'}/${sourceInfo.codec}`,deliveryInfo:sourceInfo,outputFormat:extension.slice(1),transcoded:!native,losslessSourceClaim:false,sha256:sha256(await readFile(output))};
}
