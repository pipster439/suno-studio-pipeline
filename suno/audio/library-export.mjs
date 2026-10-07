import {LibraryClient} from '../library/client.mjs';
import {retry429} from './upload.mjs';

// Official ModelNameTagClip reads this server-supplied badge, not metadata.type.
export function studioBadgeName(song) {
  return song?.metadata?.model_badges?.songrow?.display_name ?? null;
}
export function verifyLibraryExport(membership, binding, renderId) {
  const song = membership.song, m = song?.metadata;
  const provenance = song?.id === renderId && song.status === 'complete' &&
    song.entity_type === 'song_schema' && song.is_hidden !== true && song.is_trashed !== true &&
    m?.type === 'studio_export' && m.studio_project_id === binding.projectId &&
    m.studio_project_version_id === binding.versionId && m.studio_project_start_beats === binding.startBeats &&
    m.studio_project_end_beats === binding.endBeats;
  const badge = studioBadgeName(song);
  const verified = membership.visible === true && provenance && badge === 'STUDIO';
  return {renderId, finalSongId: membership.visible === true ? song.id : null,
    libraryVisible: membership.visible === true, membershipDeterminate: membership.visible !== null,
    pagesRead: membership.pagesRead, studioBadgeVerified: verified, studioBadge: badge,
    studioProvenanceVerified: !!provenance, metadataType: m?.type ?? null,
    projectId: binding.projectId, versionId: binding.versionId,
    verifiedAt: new Date().toISOString(), status: verified ? 'COMPLETE' : 'INCOMPLETE',
    reason: verified ? null : membership.visible !== true ? 'FINAL_LIBRARY_ASSET_NOT_CREATED' : 'STUDIO_PROVENANCE_NOT_VERIFIED'};
}
export async function resolveLibraryExport(bridge, complete, binding, {
  client = new LibraryClient({call: q => retry429(() => bridge.call(q))}), timeoutMs = 180000, now = Date.now,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)), log = async () => {}, persist = async () => {}
} = {}) {
  const start = now(); let result;
  if (typeof complete.user_id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(complete.user_id)) {
    result={...verifyLibraryExport({visible:null,pagesRead:0},binding,complete.id),membershipReason:'CURRENT_ACCOUNT_ID_UNAVAILABLE'};
    await persist(result); await log({event:'library_export_unverified',...result}); return result;
  }
  for (;;) {
    // owner comes from this account's bound rendered asset, never a guessed account.
    const membership = await client.is_song_in_library(complete.user_id, complete.id);
    result = verifyLibraryExport(membership, binding, complete.id);
    await persist(result); await log({event: result.status === 'COMPLETE' ? 'library_export_verified' : 'library_export_wait', ...result});
    if (result.status === 'COMPLETE' || now() - start >= timeoutMs) return result;
    // A context asset is not a formal export. Never promote it through guessed writes.
    if (complete.metadata?.type === 'rendered_context_window') return result;
    await wait(Math.min(10000, timeoutMs - (now() - start)));
  }
}
