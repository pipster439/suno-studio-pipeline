export class NotImplementedError extends Error {}
export class StudioClient {
  constructor(bridge) { this.bridge = bridge; }
  create_project() { throw new NotImplementedError('UNKNOWN: creation has not been observed/replayed'); }
  get_project() { throw new NotImplementedError('UNKNOWN: project read has not been observed/replayed'); }
  add_audio() { throw new NotImplementedError('UNKNOWN'); }
  add_clip() { throw new NotImplementedError('UNKNOWN'); }
  move_clip() { throw new NotImplementedError('UNKNOWN'); }
  trim_clip() { throw new NotImplementedError('UNKNOWN'); }
  update_clip() { throw new NotImplementedError('UNKNOWN'); }
  set_timeline() { throw new NotImplementedError('UNKNOWN'); }
  save_project() { throw new NotImplementedError('UNKNOWN'); }
  export_project() { throw new NotImplementedError('UNKNOWN'); }
}
