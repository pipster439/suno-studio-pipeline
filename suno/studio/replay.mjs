import { BridgeError } from '../bridge/errors.mjs';
import { StudioClient } from './operations.mjs';
import { isDeepStrictEqual } from 'node:util';
export class ReplayTransport{
  constructor(records){this.records=structuredClone(records);this.index=0;this.networkWriteCount=0;this.origin='SIMULATED_OFFLINE';}
  async call(call){const record=this.records[this.index];if(!record||record.request.method!==call.method||record.request.path!==call.path||!isDeepStrictEqual(record.request.body??null,call.body??null))throw new BridgeError('validation_error','offline replay request mismatch');
    this.index++;if(record.response.error)throw new BridgeError(record.response.error.kind??'unknown_error',record.response.error.message??'recorded failure',record.response.status);
    if(record.response.status>=400)throw new BridgeError('suno_api_error','recorded HTTP failure',record.response.status);
    return {ok:true,status:record.response.status,result:structuredClone(record.response.body),origin:this.origin};}
  client(options){return new StudioClient(this,options);}
  assertConsumed(){if(this.index!==this.records.length)throw Error('unconsumed replay records');return true;}
}
export class RenderJob{
  constructor(response){this.response=structuredClone(response);this.clipId=typeof response?.id==='string'?response.id:null;this.state=this.clipId?(response.status==='queued'?'QUEUED':'CLIP_REFERENCE_RECEIVED'):'UNKNOWN_RESPONSE';this.networkPollingAllowed=false;}
  observeClip(metadata){if(!this.clipId||metadata?.id!==this.clipId)throw Error('rendered clip identity mismatch');this.metadata=structuredClone(metadata);this.state='METADATA_OBSERVED';return this;}
  poll(){throw new BridgeError('not_verified','render polling endpoint has no live READ verification');}
}
export class ExpectedProjectVersion{constructor(projectId,versionId){this.projectId=projectId;this.versionId=versionId;}check(project){return {matches:project.id===this.projectId&&project.latest_version_id===this.versionId,expected:this.versionId,actual:project.latest_version_id,localPreconditionOnly:true,wireFieldsAdded:[]};}}
