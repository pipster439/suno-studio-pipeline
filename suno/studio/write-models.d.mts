export interface SavedProject {id:string;version_id:string;[key:string]:unknown;}
export interface QueuedRender {id:string;status:'queued';entity_type:'song_schema';metadata:{studio_project_id:string;studio_project_version_id:string;studio_project_start_beats:number;studio_project_end_beats:number;[key:string]:unknown;};[key:string]:unknown;}
export function savedProject(response:{result:unknown;status?:number},projectId:string):SavedProject;
export function queuedRender(response:{result:unknown;status?:number},input:{studio_project_id:string;studio_project_version_id:string;start_beats:number;end_beats:number}):QueuedRender;
