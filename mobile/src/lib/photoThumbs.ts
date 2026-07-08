// Photo citation thumbnails (SPEC.md v1.3 - Mobile UI/UX - Live assembly).
// Citations reference photo ids that are the filename stem of the capture's
// storage path ('{user_id}/{job_id}/photo-3-ab12.jpg' -> 'photo-3-ab12'),
// so the map is keyed by stem and valued with a 1h signed URL from the
// private 'captures' bucket.

import { supabase } from './supabase';

const SIGNED_URL_TTL_SECONDS = 60 * 60;

export function photoStemFromPath(storagePath: string): string {
  const filename = storagePath.split('/').pop() ?? storagePath;
  return filename.replace(/\.[^.]+$/, '');
}

export async function fetchPhotoThumbs(
  jobId: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  const { data, error } = await supabase
    .from('captures')
    .select('storage_path')
    .eq('job_id', jobId)
    .eq('kind', 'photo');
  if (error || !data || data.length === 0) {
    return map;
  }

  const paths = data.map((row) => String(row.storage_path));
  const { data: signed, error: signError } = await supabase.storage
    .from('captures')
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (signError || !signed) {
    return map;
  }

  signed.forEach((entry, index) => {
    if (entry.signedUrl) {
      map.set(photoStemFromPath(entry.path ?? paths[index]), entry.signedUrl);
    }
  });
  return map;
}
