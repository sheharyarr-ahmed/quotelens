import { File } from 'expo-file-system';

import { supabase } from '@/lib/supabase';

// Eager-upload helpers for the capture session (SPEC.md - Mobile UI/UX -
// Capture session). Media goes straight to the private `captures` bucket
// under RLS-scoped '{user_id}/{job_id}/...' paths; supabase-js on React
// Native needs a raw ArrayBuffer body (Blob/FormData are unreliable), so we
// read the local file through expo-file-system's File API first.

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function uploadCaptureFile(
  localUri: string,
  storagePath: string,
  contentType: string,
): Promise<void> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = await new File(localUri).bytes();
  } catch (error) {
    throw new Error(`Could not read capture file ${localUri}: ${describe(error)}`);
  }

  const { error } = await supabase.storage
    .from('captures')
    .upload(storagePath, bytes.buffer, { contentType, upsert: true });
  if (error) {
    throw new Error(`Upload of ${storagePath} failed: ${error.message}`);
  }
}

// Best-effort bulk delete used by "Discard capture?" and by removing a
// single already-uploaded thumbnail. Missing objects are not an error.
export async function deleteCaptureFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) {
    return;
  }
  const { error } = await supabase.storage.from('captures').remove(paths);
  if (error) {
    throw new Error(`Could not delete captured media: ${error.message}`);
  }
}
