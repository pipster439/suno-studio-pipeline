const ptr=k=>String(k).replaceAll('~','~0').replaceAll('/','~1');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const type=v=>v===null?'null':Array.isArray(v)?'array':typeof v;
export function studioStateDiff(before,after){
  const changes=[];
  function item(kind,path,a,b,extra={}){changes.push({kind,path,...(a!==undefined?{before:structuredClone(a)}:{}),...(b!==undefined?{after:structuredClone(b)}:{}),classification:/\/(?:id|focusedTrackId)$/.test(path)&&(uuid.test(a??'')||uuid.test(b??''))?'EXPECTED_DYNAMIC_ID':'SEMANTIC',...extra});}
  function walk(a,b,path){
    if(Object.is(a,b))return;
    if(type(a)!==type(b)){item('type_changed',path,a,b);return;}
    if(Array.isArray(a)){
      const keyed=[a,b].every(arr=>arr.every(v=>v&&typeof v==='object'&&typeof v.id==='string')&&new Set(arr.map(v=>v.id)).size===arr.length);
      if(keyed){const ai=a.map(v=>v.id),bi=b.map(v=>v.id);
        if(ai.length===bi.length&&ai.every(id=>bi.includes(id))&&ai.some((id,i)=>id!==bi[i]))item('array_reordered',path,ai,bi);
        for(let i=0;i<a.length;i++)if(!bi.includes(ai[i]))item('removed',path+'/'+i,a[i],undefined,{objectId:ai[i]});
        for(let i=0;i<b.length;i++){const old=a.find(v=>v.id===b[i].id);if(old)walk(old,b[i],path+'/'+i);else item('added',path+'/'+i,undefined,b[i],{objectId:b[i].id});}
      }else for(let i=0;i<Math.max(a.length,b.length);i++){if(i>=a.length)item('added',path+'/'+i,undefined,b[i]);else if(i>=b.length)item('removed',path+'/'+i,a[i],undefined);else walk(a[i],b[i],path+'/'+i);}
    }else if(a&&typeof a==='object')for(const key of new Set([...Object.keys(a),...Object.keys(b)])){const p=path+'/'+ptr(key);if(!Object.hasOwn(a,key))item('added',p,undefined,b[key]);else if(!Object.hasOwn(b,key))item('removed',p,a[key],undefined);else walk(a[key],b[key],p);}
    else item('changed',path,a,b);
  }
  walk(before,after,'');return {changes,counts:Object.fromEntries(['added','removed','changed','type_changed','array_reordered'].map(k=>[k,changes.filter(c=>c.kind===k).length]))};
}
export function displayDiffPath(pointer){return pointer.split('/').slice(1).map((v,i)=>/^\d+$/.test(v)?`[${v}]`:(i?'.':'')+v.replaceAll('~1','/').replaceAll('~0','~')).join('');}
