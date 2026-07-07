// Typed client for the FastAPI endpoints. The Supabase access token rides
// the Authorization header; FastAPI verifies it locally (SPEC.md - Data
// flow, auth, and access).

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';

export interface PhotoRef {
  photo_id: string;
  storage_path: string;
}

export interface GenerateRequest {
  job_id: string;
  audio_path: string;
  photos: PhotoRef[];
}

export interface GenerateResponse {
  quote_id: string;
}

async function request<T>(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`API ${path} failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export function generateQuote(
  body: GenerateRequest,
  accessToken: string,
): Promise<GenerateResponse> {
  return request<GenerateResponse>('/generate', accessToken, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export interface CaptureRegistration {
  job_id: string;
  kind: 'photo' | 'audio';
  storage_path: string;
}

export function registerCapture(
  body: CaptureRegistration,
  accessToken: string,
): Promise<{ id: string }> {
  return request<{ id: string }>('/captures', accessToken, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// Regenerate re-runs the pipeline from the cached transcript and photo
// observations; it never re-pays transcription or vision (SPEC.md - Pipeline).
export function regenerateQuote(
  quoteId: string,
  accessToken: string,
): Promise<GenerateResponse> {
  return request<GenerateResponse>(`/quotes/${quoteId}/regenerate`, accessToken, {
    method: 'POST',
  });
}
