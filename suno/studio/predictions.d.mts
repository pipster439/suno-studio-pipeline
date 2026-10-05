import type{StudioState}from'./models.js';import type{SourceClip,StudioPostProcessProfile,UploaderCompatibilityProfile,WarpHashStrategyValue}from'./dry-run-sdk.mjs';
export interface Prediction{state:StudioState;diff:ReturnType<typeof import('./state-diff.mjs').studioStateDiff>;status:'FOUND_STATICALLY';rule:string;serverVerified:false;arrangementId?:string;dynamicPaths?:string[];}
export function predictAddClipDiff(before:StudioState,source:SourceClip,options?:{trackId?:string;profile:StudioPostProcessProfile;timelineStart?:number;compatibility?:UploaderCompatibilityProfile;hashStrategy?:WarpHashStrategyValue}):Prediction;
export function predictMoveClipDiff(before:StudioState,id:string,start:number):Prediction;
export function predictTranspositionDiff(before:StudioState,id:string,value:number):Prediction;
export function predictFadeDiff(before:StudioState,id:string,explicit:Record<string,number>):Prediction;
export function comparePredictionToCapture(predicted:unknown,actual:unknown,options?:{dynamicPaths?:string[];captureOrigin?:string;readbackConfirmed?:boolean;reproductionConfirmed?:boolean}):{matched:boolean;rows:unknown[];counts:Record<string,number>;confidenceUpgradeRecommendation:{eligibleForVerified:boolean;humanReviewRequired:true;documentsChanged:false;reason:string};status:string};
