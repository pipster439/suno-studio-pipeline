import { sample, wav, decode, ffmpeg, readPCM } from './pcm.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { estimateSpectralPitchShift } from './spectral-pitch.mjs';
export const TRANSFORM_THRESHOLDS=Object.freeze({version:'transform-v3',durationMs:50,pitchCents:35,transientLagMs:20,rmsDeltaDb:3,clippingSamples:0,spectralCosine:.85});
export function syntheticReference(seconds=24,rate=48000) {
  const frames=Math.round(seconds*rate),data=Buffer.alloc(frames*8);let seed=142857;
  for(let i=0;i<frames;i++){
    const t=i/rate,section=t%12;seed=(Math.imul(seed,1664525)+1013904223)>>>0;const noise=(seed/2**32*2-1);
    let x;
    if(section<2)x=.18*Math.sin(2*Math.PI*220*t);
    else if(section<4)x=.16*Math.sin(2*Math.PI*440*t);
    else if(section<6)x=.12*Math.sin(2*Math.PI*(300*(section-4)+600*(section-4)**2));
    else {const beat=(t-.123)% .5,env=beat>=0?Math.exp(-beat*45):0;
      x=.05*Math.sin(2*Math.PI*137*t)+.035*Math.sin(2*Math.PI*411*t)+.025*Math.sin(2*Math.PI*1096*t)+noise*(.025+.22*env)+.12*env*Math.sin(2*Math.PI*65*beat);}
    // Fixed reference endpoint ramp only avoids synthetic signal onset/end clicks.
    x*=Math.min(1,t/.02,(seconds-t)/.02);
    data.writeFloatLE(x,i*8);data.writeFloatLE(x*.96,i*8+4);
  }
  return {frames,data,sampleRate:rate,channels:2,bits:32,tag:3,blockAlign:8};
}
function levels(pcm){let peak=0,energy=0,clipping=0;for(let i=0;i<pcm.frames;i++)for(let c=0;c<pcm.channels;c++){const x=sample(pcm,i,c);peak=Math.max(peak,Math.abs(x));energy+=x*x;if(Math.abs(x)>=.999)clipping++;}return{peak,rms:Math.sqrt(energy/(pcm.frames*pcm.channels)),clipping};}
function toneFrequency(pcm,center=1) {
  const stride=Math.max(1,Math.floor(pcm.sampleRate/12000)),rate=pcm.sampleRate/stride,n=Math.round(rate*.25),start=Math.round(center*pcm.sampleRate);
  const values=Array.from({length:n},(_,i)=>sample(pcm,Math.min(pcm.frames-1,start+i*stride),0)*(.5-.5*Math.cos(2*Math.PI*i/(n-1))));
  function power(f){const coefficient=2*Math.cos(2*Math.PI*f/rate);let a=0,b=0;for(const x of values){const next=x+coefficient*a-b;b=a;a=next;}return a*a+b*b-coefficient*a*b;}
  let best={hz:0,power:-1};for(let f=100;f<=800;f+=2){const p=power(f);if(p>best.power)best={hz:f,power:p};}
  const coarse=best.hz;for(let f=coarse-2;f<=coarse+2;f+=.1){const p=power(f);if(p>best.power)best={hz:f,power:p};}
  return{hz:best.hz,method:'Hann-window Goertzel spectral peak; valid only for known synthetic tone; 0.1 Hz resolution'};
}
function envelope(p){const hop=Math.round(p.sampleRate*.01),result=[];for(let a=0;a<p.frames;a+=hop){let energy=0,n=0;for(let i=a;i<Math.min(p.frames,a+hop);i+=4){const x=sample(p,i,0);energy+=x*x;n++;}result.push(Math.sqrt(energy/Math.max(1,n)));}return result;}
function correlation(x,y){const n=Math.min(x.length,y.length);if(!n)return 0;const ax=x.slice(0,n).reduce((s,v)=>s+v,0)/n,ay=y.slice(0,n).reduce((s,v)=>s+v,0)/n;let xy=0,xx=0,yy=0;for(let i=0;i<n;i++){const a=x[i]-ax,b=y[i]-ay;xy+=a*b;xx+=a*a;yy+=b*b;}return xy/Math.max(1e-12,Math.sqrt(xx*yy));}
function spectrum(pcm) {
  const size=2048,bands=Array(32).fill(0),count=24;
  for(let w=0;w<count;w++){
    const origin=Math.round((pcm.frames-size)*((w+.5)/count)),re=new Float64Array(size),im=new Float64Array(size);
    for(let i=0;i<size;i++){let value=0;for(let c=0;c<pcm.channels;c++)value+=sample(pcm,Math.max(0,Math.min(pcm.frames-1,origin+i)),c);re[i]=value/pcm.channels*(.5-.5*Math.cos(2*Math.PI*i/(size-1)));}
    for(let i=1,j=0;i<size;i++){let bit=size>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[re[i],re[j]]=[re[j],re[i]];}}
    for(let length=2;length<=size;length*=2){const theta=-2*Math.PI/length;for(let base=0;base<size;base+=length)for(let j=0;j<length/2;j++){const a=base+j,b=a+length/2,c=Math.cos(theta*j),s=Math.sin(theta*j),r=re[b]*c-im[b]*s,i=re[b]*s+im[b]*c;re[b]=re[a]-r;im[b]=im[a]-i;re[a]+=r;im[a]+=i;}}
    for(let i=1;i<size/2;i++){const hz=i*pcm.sampleRate/size;if(hz<20||hz>16000)continue;const band=Math.min(31,Math.floor(Math.log(hz/20)/Math.log(800)*32));bands[band]+=re[i]**2+im[i]**2;}
  }
  return bands.map(x=>Math.sqrt(x/count));
}
export function compareTransforms(reference,rendered,{synthetic=false}={}) {
  if(reference.sampleRate!==rendered.sampleRate||reference.channels!==rendered.channels)throw Error('Comparison requires equal sample rate/channels');
  const a=levels(reference),b=levels(rendered),x=envelope(reference),y=envelope(rendered);let best={lag:0,correlation:-1};
  for(let lag=-10;lag<=10;lag++){const score=correlation(lag<0?x.slice(-lag):x,lag>0?y.slice(lag):y);if(score>best.correlation)best={lag,correlation:score};}
  const durationErrorMs=(rendered.frames-reference.frames)/reference.sampleRate*1000,rmsDeltaDb=20*Math.log10(Math.max(1e-12,b.rms)/Math.max(1e-12,a.rms));
  const pitch=synthetic?{reference:toneFrequency(reference),rendered:toneFrequency(rendered)}:null;
  if(pitch)pitch.deltaCents=1200*Math.log2(pitch.rendered.hz/pitch.reference.hz);
  const spectralPitch=synthetic?null:estimateSpectralPitchShift(reference,rendered,{lagMs:best.lag*10});
  let xy=0,xx=0,yy=0;const n=Math.min(reference.frames,rendered.frames);for(let i=0;i<n;i+=4){const u=sample(reference,i,0),v=sample(rendered,i,0);xy+=u*v;xx+=u*u;yy+=v*v;}
  const spectralA=spectrum(reference),spectralB=spectrum(rendered),cosine=spectralA.reduce((s,v,i)=>s+v*spectralB[i],0)/Math.max(1e-12,Math.hypot(...spectralA)*Math.hypot(...spectralB));
  const warnings=[];if(Math.abs(durationErrorMs)>TRANSFORM_THRESHOLDS.durationMs)warnings.push('duration');if(pitch&&Math.abs(pitch.deltaCents)>TRANSFORM_THRESHOLDS.pitchCents)warnings.push('pitch');if(Math.abs(best.lag*10)>TRANSFORM_THRESHOLDS.transientLagMs||best.correlation<.8)warnings.push('transient alignment');if(Math.abs(rmsDeltaDb)>TRANSFORM_THRESHOLDS.rmsDeltaDb)warnings.push('RMS restoration');if(cosine<TRANSFORM_THRESHOLDS.spectralCosine)warnings.push('spectral distribution');
  if(b.clipping>TRANSFORM_THRESHOLDS.clippingSamples&&!warnings.includes('clipping'))warnings.push('clipping');
  if(spectralPitch?.deltaCents!=null&&Math.abs(spectralPitch.deltaCents)>TRANSFORM_THRESHOLDS.pitchCents)warnings.push('estimated spectral pitch');
  return {thresholdVersion:TRANSFORM_THRESHOLDS.version,sourceDuration:reference.frames/reference.sampleRate,renderDuration:rendered.frames/rendered.sampleRate,durationErrorMs,pitch,spectralPitch,pitchStatus:synthetic?'MEASURED_SYNTHETIC_TONE':spectralPitch.status,transientAlignment:{lagMs:best.lag*10,correlation:best.correlation,resolutionMs:10,method:'RMS envelope correlation'},rmsDeltaDb,peakDeltaDb:20*Math.log10(Math.max(1e-12,b.peak)/Math.max(1e-12,a.peak)),clippingCandidates:b.clipping,sourceClippingCandidates:a.clipping,peak:b.peak,sourcePeak:a.peak,waveformCorrelation:xy/Math.max(1e-12,Math.sqrt(xx*yy)),spectralSimilarity:{cosine,method:'24 Hann FFT windows; 32 log amplitude bands; distribution proxy, not perceptual equivalence'},formantSimilarity:'NOT VERIFIED; synthetic harmonics are not human voice evidence',classification:warnings.length?'WARN':'PASS',warnings};
}
export async function verifyTransformFile(input,rendered,referenceFile,{synthetic=false}={}) {
  await ffmpeg(['-y','-i',input,'-ar',String(rendered.sampleRate),'-ac',String(rendered.channels),'-c:a','pcm_f32le',referenceFile]);
  return compareTransforms(readPCM(await readFile(referenceFile)),rendered,{synthetic});
}
