import {
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { AppState } from 'react-native';

import { generateQuote, registerCapture } from '@/api/client';
import { supabase } from '@/lib/supabase';
import { deleteCaptureFiles, uploadCaptureFile } from '@/lib/uploads';

// Walk-and-talk capture session state machine (SPEC.md - Mobile UI/UX -
// Capture session): one continuous audio recording auto-starts while photos
// eager-upload the moment they are captured. photo_id doubles as the storage
// filename stem so the review screen can map citations back to thumbnails
// through the captures rows.

export const MAX_PHOTOS = 10;
export const MAX_RECORDING_SECONDS = 180;
export const COUNTDOWN_THRESHOLD_SECONDS = 150;

export type UploadState = 'uploading' | 'done' | 'failed';

export interface CapturedPhoto {
  photoId: string;
  localUri: string;
  storagePath: string;
  uploadState: UploadState;
  captureRowId?: string;
}

export type RecordingStatus = 'recording' | 'paused' | 'stopped';

export type SessionPhase = 'capturing' | 'review' | 'generating';

export interface CaptureSessionState {
  photos: CapturedPhoto[];
  recording: { status: RecordingStatus; elapsedSec: number };
  phase: SessionPhase;
  audio: {
    localUri?: string;
    storagePath?: string;
    durationSec?: number;
    uploadState: 'idle' | UploadState;
    captureRowId?: string;
  };
}

type Action =
  | { type: 'PHOTO_ADDED'; photoId: string; localUri: string; storagePath: string }
  | { type: 'PHOTO_UPLOAD_SUCCEEDED'; photoId: string; captureRowId: string }
  | { type: 'PHOTO_UPLOAD_FAILED'; photoId: string }
  | { type: 'PHOTO_UPLOAD_RETRYING'; photoId: string }
  | { type: 'PHOTO_REMOVED'; photoId: string }
  | { type: 'RECORDING_TICK'; elapsedSec: number }
  | { type: 'RECORDING_PAUSED' }
  | { type: 'RECORDING_RESUMED' }
  | {
      type: 'RECORDING_STOPPED';
      localUri?: string;
      storagePath?: string;
      durationSec: number;
      uploadState: UploadState;
    }
  | { type: 'AUDIO_UPLOAD_SUCCEEDED'; captureRowId: string }
  | { type: 'AUDIO_UPLOAD_FAILED' }
  | { type: 'AUDIO_UPLOAD_RETRYING' }
  | { type: 'GENERATE_STARTED' }
  | { type: 'GENERATE_FAILED' };

const initialState: CaptureSessionState = {
  photos: [],
  recording: { status: 'recording', elapsedSec: 0 },
  phase: 'capturing',
  audio: { uploadState: 'idle' },
};

function setPhotoState(
  photos: CapturedPhoto[],
  photoId: string,
  patch: Partial<CapturedPhoto>,
): CapturedPhoto[] {
  return photos.map((photo) => (photo.photoId === photoId ? { ...photo, ...patch } : photo));
}

function reducer(state: CaptureSessionState, action: Action): CaptureSessionState {
  switch (action.type) {
    case 'PHOTO_ADDED':
      return {
        ...state,
        photos: [
          ...state.photos,
          {
            photoId: action.photoId,
            localUri: action.localUri,
            storagePath: action.storagePath,
            uploadState: 'uploading',
          },
        ],
      };
    case 'PHOTO_UPLOAD_SUCCEEDED':
      return {
        ...state,
        photos: setPhotoState(state.photos, action.photoId, {
          uploadState: 'done',
          captureRowId: action.captureRowId,
        }),
      };
    case 'PHOTO_UPLOAD_FAILED':
      return {
        ...state,
        photos: setPhotoState(state.photos, action.photoId, { uploadState: 'failed' }),
      };
    case 'PHOTO_UPLOAD_RETRYING':
      return {
        ...state,
        photos: setPhotoState(state.photos, action.photoId, { uploadState: 'uploading' }),
      };
    case 'PHOTO_REMOVED':
      return {
        ...state,
        photos: state.photos.filter((photo) => photo.photoId !== action.photoId),
      };
    case 'RECORDING_TICK':
      if (state.recording.status !== 'recording') {
        return state;
      }
      return { ...state, recording: { ...state.recording, elapsedSec: action.elapsedSec } };
    case 'RECORDING_PAUSED':
      if (state.recording.status !== 'recording') {
        return state;
      }
      return { ...state, recording: { ...state.recording, status: 'paused' } };
    case 'RECORDING_RESUMED':
      if (state.recording.status !== 'paused') {
        return state;
      }
      return { ...state, recording: { ...state.recording, status: 'recording' } };
    case 'RECORDING_STOPPED':
      return {
        ...state,
        phase: 'review',
        recording: { status: 'stopped', elapsedSec: action.durationSec },
        audio: {
          localUri: action.localUri,
          storagePath: action.storagePath,
          durationSec: action.durationSec,
          uploadState: action.uploadState,
        },
      };
    case 'AUDIO_UPLOAD_SUCCEEDED':
      return {
        ...state,
        audio: { ...state.audio, uploadState: 'done', captureRowId: action.captureRowId },
      };
    case 'AUDIO_UPLOAD_FAILED':
      return { ...state, audio: { ...state.audio, uploadState: 'failed' } };
    case 'AUDIO_UPLOAD_RETRYING':
      return { ...state, audio: { ...state.audio, uploadState: 'uploading' } };
    case 'GENERATE_STARTED':
      return { ...state, phase: 'generating' };
    case 'GENERATE_FAILED':
      return { ...state, phase: 'review' };
    default:
      return state;
  }
}

async function getAccessToken(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) {
    throw new Error('Not signed in - cannot reach the QuoteLens API.');
  }
  return token;
}

export interface CaptureSession {
  state: CaptureSessionState;
  canGenerate: boolean;
  addPhoto: (localUri: string) => Promise<void>;
  retryPhotoUpload: (photoId: string) => void;
  removePhoto: (photoId: string) => void;
  resumeRecording: () => void;
  finishAndReview: () => Promise<void>;
  retryAudioUpload: () => void;
  generate: () => Promise<string>;
  discard: () => Promise<void>;
}

export function useCaptureSession(jobId: string): CaptureSession {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [state, dispatch] = useReducer(reducer, initialState);

  // Mirror the latest state for callbacks that must not resubscribe on every
  // reducer transition (AppState listener, discard, generate).
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const userIdRef = useRef<string | null>(null);
  const startTsRef = useRef<number>(Date.now());
  const photoCounterRef = useRef(0);
  const startedRef = useRef(false);
  const finishingRef = useRef(false);

  const ensureUserId = useCallback(async (): Promise<string> => {
    if (userIdRef.current) {
      return userIdRef.current;
    }
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const userId = session?.user.id ?? null;
    userIdRef.current = userId;
    if (!userId) {
      throw new Error('Not signed in - cannot upload capture media.');
    }
    return userId;
  }, []);

  // Recording auto-starts when the session starts (the gate has already
  // granted both permissions before this hook mounts).
  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;
    startTsRef.current = Date.now();
    let cancelled = false;
    (async () => {
      await ensureUserId().catch(() => {
        // Uploads surface the auth failure per item; recording still starts.
      });
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      if (!cancelled) {
        recorder.record();
      }
    })().catch(() => {
      // A recorder that cannot start still leaves the camera usable; the
      // audio upload row will fail loudly at Finish & Review.
    });
    return () => {
      cancelled = true;
    };
  }, [recorder, ensureUserId]);

  // Release the recording audio session when the screen unmounts.
  useEffect(() => {
    return () => {
      void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    };
  }, []);

  const performPhotoUpload = useCallback(
    async (photoId: string, localUri: string, storagePath: string) => {
      try {
        await uploadCaptureFile(localUri, storagePath, 'image/jpeg');
        const token = await getAccessToken();
        const { id } = await registerCapture(
          { job_id: jobId, kind: 'photo', storage_path: storagePath },
          token,
        );
        dispatch({ type: 'PHOTO_UPLOAD_SUCCEEDED', photoId, captureRowId: id });
      } catch {
        dispatch({ type: 'PHOTO_UPLOAD_FAILED', photoId });
      }
    },
    [jobId],
  );

  // Eager upload: fires the moment the shutter resolves. photo_id equals the
  // storage filename stem by convention (SPEC.md - Capture session).
  const addPhoto = useCallback(
    async (localUri: string) => {
      const userId = await ensureUserId();
      photoCounterRef.current += 1;
      const photoId = `photo-${photoCounterRef.current}-${Math.random().toString(36).slice(2, 8)}`;
      const storagePath = `${userId}/${jobId}/${photoId}.jpg`;
      dispatch({ type: 'PHOTO_ADDED', photoId, localUri, storagePath });
      await performPhotoUpload(photoId, localUri, storagePath);
    },
    [ensureUserId, jobId, performPhotoUpload],
  );

  const retryPhotoUpload = useCallback(
    (photoId: string) => {
      const photo = stateRef.current.photos.find((entry) => entry.photoId === photoId);
      if (!photo || photo.uploadState !== 'failed') {
        return;
      }
      dispatch({ type: 'PHOTO_UPLOAD_RETRYING', photoId });
      void performPhotoUpload(photoId, photo.localUri, photo.storagePath);
    },
    [performPhotoUpload],
  );

  const removePhoto = useCallback((photoId: string) => {
    const photo = stateRef.current.photos.find((entry) => entry.photoId === photoId);
    if (!photo) {
      return;
    }
    dispatch({ type: 'PHOTO_REMOVED', photoId });
    // Best-effort cleanup of whatever the eager upload already landed.
    void (async () => {
      try {
        await deleteCaptureFiles([photo.storagePath]);
      } catch {}
      try {
        if (photo.captureRowId) {
          await supabase.from('captures').delete().eq('id', photo.captureRowId);
        } else {
          await supabase.from('captures').delete().eq('storage_path', photo.storagePath);
        }
      } catch {}
    })();
  }, []);

  const pauseRecording = useCallback(() => {
    const current = stateRef.current;
    if (current.phase !== 'capturing' || current.recording.status !== 'recording') {
      return;
    }
    try {
      recorder.pause();
    } catch {}
    dispatch({ type: 'RECORDING_PAUSED' });
  }, [recorder]);

  const resumeRecording = useCallback(() => {
    if (stateRef.current.recording.status !== 'paused') {
      return;
    }
    try {
      recorder.record();
    } catch {}
    dispatch({ type: 'RECORDING_RESUMED' });
  }, [recorder]);

  // Backgrounding pauses the recording; the screen shows a resume banner
  // when the user comes back (SPEC.md - Capture session).
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background') {
        pauseRecording();
      }
    });
    return () => {
      subscription.remove();
    };
  }, [pauseRecording]);

  const uploadAudio = useCallback(
    async (localUri: string | undefined, storagePath: string) => {
      if (!localUri) {
        dispatch({ type: 'AUDIO_UPLOAD_FAILED' });
        return;
      }
      try {
        await uploadCaptureFile(localUri, storagePath, 'audio/m4a');
        const token = await getAccessToken();
        const { id } = await registerCapture(
          { job_id: jobId, kind: 'audio', storage_path: storagePath },
          token,
        );
        dispatch({ type: 'AUDIO_UPLOAD_SUCCEEDED', captureRowId: id });
      } catch {
        dispatch({ type: 'AUDIO_UPLOAD_FAILED' });
      }
    },
    [jobId],
  );

  // 'Finish & Review' (or the 180s auto-stop) ends the walkthrough: stop the
  // recorder, then upload the audio file.
  const finishAndReview = useCallback(async () => {
    if (finishingRef.current || stateRef.current.phase !== 'capturing') {
      return;
    }
    finishingRef.current = true;
    const measuredSec = Math.floor(recorder.currentTime);
    const durationSec = measuredSec > 0 ? measuredSec : stateRef.current.recording.elapsedSec;
    try {
      await recorder.stop();
    } catch {}
    const localUri = recorder.uri ?? undefined;
    let storagePath: string;
    try {
      const userId = await ensureUserId();
      storagePath = `${userId}/${jobId}/audio-${startTsRef.current}.m4a`;
    } catch {
      // No session means every upload in this session is dead anyway; land
      // in review with a failed audio row so the user can only discard.
      dispatch({ type: 'RECORDING_STOPPED', localUri, durationSec, uploadState: 'failed' });
      return;
    }
    dispatch({
      type: 'RECORDING_STOPPED',
      localUri,
      storagePath,
      durationSec,
      uploadState: 'uploading',
    });
    await uploadAudio(localUri, storagePath);
  }, [recorder, ensureUserId, jobId, uploadAudio]);

  const retryAudioUpload = useCallback(() => {
    const { audio } = stateRef.current;
    if (audio.uploadState !== 'failed' || !audio.storagePath) {
      return;
    }
    dispatch({ type: 'AUDIO_UPLOAD_RETRYING' });
    void uploadAudio(audio.localUri, audio.storagePath);
  }, [uploadAudio]);

  // Elapsed-time ticker; auto-stops the session at the 3-minute soft limit.
  useEffect(() => {
    if (state.phase !== 'capturing' || state.recording.status !== 'recording') {
      return;
    }
    const interval = setInterval(() => {
      const elapsedSec = Math.floor(recorder.currentTime);
      dispatch({ type: 'RECORDING_TICK', elapsedSec });
      if (elapsedSec >= MAX_RECORDING_SECONDS) {
        void finishAndReview();
      }
    }, 500);
    return () => {
      clearInterval(interval);
    };
  }, [state.phase, state.recording.status, recorder, finishAndReview]);

  const generate = useCallback(async (): Promise<string> => {
    const current = stateRef.current;
    const audioPath = current.audio.storagePath;
    if (!audioPath || current.audio.uploadState !== 'done') {
      throw new Error('The walkthrough audio has not finished uploading.');
    }
    const photos = current.photos.filter((photo) => photo.uploadState === 'done');
    if (photos.length === 0) {
      throw new Error('At least one uploaded photo is required.');
    }
    dispatch({ type: 'GENERATE_STARTED' });
    try {
      const token = await getAccessToken();
      const { quote_id } = await generateQuote(
        {
          job_id: jobId,
          audio_path: audioPath,
          photos: photos.map((photo) => ({
            photo_id: photo.photoId,
            storage_path: photo.storagePath,
          })),
        },
        token,
      );
      return quote_id;
    } catch (error) {
      dispatch({ type: 'GENERATE_FAILED' });
      throw error;
    }
  }, [jobId]);

  // Discard deletes any already-uploaded media plus its captures rows, and
  // stops a still-running recording. Best-effort by design: the caller
  // navigates away immediately after.
  const discard = useCallback(async () => {
    const current = stateRef.current;
    if (current.recording.status !== 'stopped') {
      finishingRef.current = true;
      try {
        await recorder.stop();
      } catch {}
    }
    const paths = current.photos.map((photo) => photo.storagePath);
    if (current.audio.storagePath && current.audio.uploadState !== 'idle') {
      paths.push(current.audio.storagePath);
    }
    if (paths.length === 0) {
      return;
    }
    try {
      await deleteCaptureFiles(paths);
    } catch {}
    try {
      await supabase.from('captures').delete().in('storage_path', paths);
    } catch {}
  }, [recorder]);

  const canGenerate =
    state.phase === 'review' &&
    state.photos.length >= 1 &&
    state.photos.every((photo) => photo.uploadState === 'done') &&
    state.audio.uploadState === 'done';

  return {
    state,
    canGenerate,
    addPhoto,
    retryPhotoUpload,
    removePhoto,
    resumeRecording,
    finishAndReview,
    retryAudioUpload,
    generate,
    discard,
  };
}
