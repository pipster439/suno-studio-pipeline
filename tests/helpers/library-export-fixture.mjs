// Extend existing audio-only test servers with an explicit formal export feed.
// New Library-specific tests independently cover absence, badge and identity.
export function libraryExportFixture(deps) {
  if(!deps.bridge)return deps;
  const owner='11111111-2222-3333-4444-555555555555', songs=new Map();
  const bridge=Object.create(deps.bridge);bridge.call=async q=>{
    if(q.path==='/api/feed/v3')return{status:200,result:{has_more:false,clips:[...songs.values()]}};
    const response=await deps.bridge.call(q);
    if(q.path.startsWith('/api/clip/')&&response.result?.status==='complete'){
      const song={...response.result,title:'fixture',entity_type:'song_schema',user_id:owner,
        metadata:{...response.result.metadata,type:'studio_export',model_badges:{songrow:{display_name:'STUDIO'}}}};
      songs.set(song.id,song);return{...response,result:song};
    }
    return response;
  };
  return{...deps,bridge,renderLifecycle:{playerProbe:async()=>({url:'https://downloads.s3.amazonaws.com/test.m4a',field:'audio_url'}),...deps.renderLifecycle}};
}
