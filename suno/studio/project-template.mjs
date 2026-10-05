import { buildProjectDraft } from './dry-run-sdk.mjs';
import { studioStateDiff } from './state-diff.mjs';
export const CONVENIENCE_FIELDS=Object.freeze(['selection','layout','contextualWindowConfig','editorPointerModes']);
export function buildEditorConvenienceState(template,timing){const {state}=buildProjectDraft(template,timing);return Object.fromEntries(CONVENIENCE_FIELDS.filter(k=>Object.hasOwn(state,k)).map(k=>[k,state[k]]));}
export function buildMinimalProjectState(template,timing){const {state}=buildProjectDraft(template,timing);return Object.fromEntries(Object.entries(state).filter(([k])=>!CONVENIENCE_FIELDS.includes(k)));}
export function sanitizeProjectTemplate(template,timing=template.state.timing){
  const draft=buildProjectDraft(template,timing),before=template.state,after=draft.state;
  // Empty draft has no marker leftovers; wire boundary is separate from editor draft.
  after.markersRegistry={};
  const diff=studioStateDiff(before,after).changes;
  const changed=new Set(diff.map(c=>c.path));
  const preserved=[];function leaves(v,p=''){if(v&&typeof v==='object'&&Object.keys(v).length)for(const[k,a]of Object.entries(v))leaves(a,p+'/'+k.replaceAll('~','~0').replaceAll('/','~1'));else if(![...changed].some(c=>p===c||p.startsWith(c+'/')))preserved.push(p);}leaves(before);
  return {draft,report:{status:'LOCAL_TEMPLATE_SANITIZATION',preservedPaths:preserved,regeneratedPaths:['/draft/id','/tracks/0/id'],removedPaths:diff.filter(c=>c.kind==='removed').map(c=>c.path),resetPaths:diff.filter(c=>c.kind!=='removed'&&c.classification!=='EXPECTED_DYNAMIC_ID').map(c=>c.path),serverVerified:false}};
}
