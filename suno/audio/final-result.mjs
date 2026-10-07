import {spawn} from 'node:child_process';

// Observed official Studio saved-song modal: href `/song/${render.id}`.
// Source: module 748387 consumer, captures/official-write/20261005/3g9-3c-u44c0o.js.
export function songPageURL(id) {
  if(typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) throw Error('Invalid final song identifier');
  return `https://suno.com/song/${id}`;
}
export async function probeSongPage(id,{fetch:request=globalThis.fetch}={}) {
  const url=songPageURL(id);let response;
  try {
    response=await request(url,{signal:AbortSignal.timeout(30000)});
    return {renderId:id,url,accessible:response.status===200 && response.url===url &&
      /text\/html/i.test(response.headers.get('content-type')??''),httpStatus:response.status,
      verifiedAt:new Date().toISOString(),verificationKind:'official_song_page_http_get'};
  } catch(error) {return {renderId:id,url,accessible:false,reason:'PAGE_CHECK_UNAVAILABLE',httpStatus:error.status??null};}
  finally {await response?.body?.cancel().catch(()=>{});}
}
export async function openSongPage(url,{launch,platform=process.platform}={}) {
  const id=new URL(url).pathname.split('/').at(-1);
  if(url!==songPageURL(id))throw Error('Only the verified official final song route can be opened');
  const command=platform==='win32'?'rundll32.exe':platform==='darwin'?'open':'xdg-open';
  const args=platform==='win32'?['url.dll,FileProtocolHandler',url]:[url];
  if(launch)return launch(command,args);
  await new Promise((resolve,reject)=>{
    const child=spawn(command,args,{stdio:'ignore',windowsHide:true,detached:true});
    child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});
  });
}
export function finalOutput(result) {
  return `DONE\n\nStudio Project:\n${result.studioProjectURL??result.projectId}\n\nMerged Song:\n${result.finalSongURL}\n\nRender ID:\n${result.renderClipId}\n\nLibrary:\n${result.libraryStatus}\n\nDirect Delivery:\n${result.deliveryStatus}\n\nQuality QA:\n${result.qualityResult??(result.quality==='PASS'?'PASS':result.quality==='UNAVAILABLE'?'UNAVAILABLE':'WARN')}`;
}
