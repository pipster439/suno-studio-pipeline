import { sample } from './pcm.mjs';

// Opt-in experiment only: estimate a constant per-asset multiplier from aligned,
// non-silent interior windows. This is not loudness normalization or a limiter.
export function estimateSliceGains(reference, rendered, slices) {
  if (reference.sampleRate !== rendered.sampleRate || reference.channels !== rendered.channels) throw Error('Gain estimation requires matching sample formats');
  const rate=reference.sampleRate, radius=Math.round(.15*rate), median=xs=>[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
  const estimates=slices.map(slice=>{
    const windows=[];
    for(const fraction of Array.from({length:15},(_,i)=>.08+i*.06)) {
      const center=Math.round((slice.startSec+slice.durSec*fraction)*rate);
      let best={correlation:-1};
      for(let lag=-16;lag<=16;lag++) {
        let xx=0,yy=0,xy=0,n=0;
        for(let i=center-radius;i<center+radius;i+=4) {
          if(i<0||i>=reference.frames||i+lag<0||i+lag>=rendered.frames)continue;
          for(let c=0;c<reference.channels;c++){const x=sample(reference,i,c),y=sample(rendered,i+lag,c);xx+=x*x;yy+=y*y;xy+=x*y;n++;}
        }
        const correlation=xy/Math.max(1e-12,Math.sqrt(xx*yy));
        if(correlation>best.correlation)best={timestamp:center/rate,lag,correlation,sourceRms:Math.sqrt(xx/Math.max(1,n)),renderRms:Math.sqrt(yy/Math.max(1,n)),ratio:Math.sqrt(yy/Math.max(1e-12,xx))};
      }
      windows.push(best);
    }
    const activeFloor=Math.max(.001,...windows.map(w=>w.sourceRms*.1));
    const usable=windows.filter(w=>w.sourceRms>=activeFloor&&w.correlation>=.9&&Number.isFinite(w.ratio)&&w.ratio>0);
    const ratio=usable.length?median(usable.map(w=>w.ratio)):null;
    const relativeSpread=ratio?Math.max(...usable.map(w=>Math.abs(w.ratio/ratio-1))):null;
    const passed=usable.length>=3&&relativeSpread<=.05&&ratio>=.1&&ratio<=10;
    return {index:slice.index,localHash:slice.localHash,clipId:slice.clipId,windows,usableWindowCount:usable.length,ratio,relativeSpread,amplitude:passed?1/ratio:null,passed};
  });
  return {passed:estimates.length>0&&estimates.every(e=>e.passed),method:'median aligned interior RMS ratio, fifteen windows, exclude near-silence, correlation >= .9, spread <= 5%',estimates};
}
