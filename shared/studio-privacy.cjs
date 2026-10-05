(function(root){
  const p=typeof module!=='undefined'?require('./privacy.cjs'):root.SunoPrivacy;
  const privateKey=/^(?:user_id|userId|account_id|accountId|email|session_id|sessionId|sid)$/i;
  const secretKey=/authorization|cookie|jwt|token|captcha|secret|password|credential|device|signature|api[-_]?key/i;
  function sanitize(v){
    const clean=p.redact(v);
    function visit(x){if(typeof x==='string')return x.replace(/\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g,'<redacted>');
      if(Array.isArray(x))return x.map(visit);
      if(x&&typeof x==='object')return Object.fromEntries(Object.entries(x).map(([k,a])=>[k,privateKey.test(k)?'<redacted>':visit(a)]));return x;}
    return visit(clean);
  }
  function headers(v){return Object.fromEntries(Object.entries(p.headers(v)).filter(([k])=>!secretKey.test(k)));}
  function evidence(v){const clean=sanitize(v),ids=new Map();function text(s){return s.replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi,id=>{if(!ids.has(id))ids.set(id,'evidence-id-'+(ids.size+1));return ids.get(id);});}function visit(x){if(typeof x==='string')return text(x);if(Array.isArray(x))return x.map(visit);if(x&&typeof x==='object')return Object.fromEntries(Object.entries(x).map(([k,a])=>[text(k),/^(?:name|title|lyrics|caption)$/.test(k)&&typeof a==='string'&&a?'<private display value>':visit(a)]));return x;}return visit(clean);}
  const api={sanitize,headers,evidence,body:v=>sanitize(p.body(v)),url:p.url};
  if(typeof module!=='undefined')module.exports=api;else root.StudioPrivacy=api;
})(globalThis);
