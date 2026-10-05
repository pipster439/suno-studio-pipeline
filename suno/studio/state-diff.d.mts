export interface StateChange{kind:'added'|'removed'|'changed'|'type_changed'|'array_reordered';path:string;before?:unknown;after?:unknown;classification:'SEMANTIC'|'EXPECTED_DYNAMIC_ID';objectId?:string;}
export function studioStateDiff(before:unknown,after:unknown):{changes:StateChange[];counts:Record<string,number>};
export function displayDiffPath(pointer:string):string;
