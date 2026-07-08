/**
 * Live end-to-end verification of the mobile data layer against the REAL
 * services: local uvicorn (FastAPI + LangGraph pipeline) + hosted Supabase.
 *
 * The shipped pure modules are imported and executed directly
 * (src/hooks/quoteAssemblyReducer, src/lib/traceGroups, src/api/client);
 * everything React/React-Native-coupled is mirrored call-for-call with
 * file:line citations to the screen/hook it reproduces.
 *
 * Run:
 *   cd mobile && set -a && source ../.env && set +a && pnpm exec tsx scripts/live-verify.ts
 *
 * Prereqs: uvicorn listening on EXPO_PUBLIC_API_URL (default
 * http://localhost:8000), all migrations applied (incl.
 * 20260707100000_realtime_publication_v13). This file is excluded from the
 * mobile tsc/eslint gate: it is tooling executed via tsx, not app code.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { generateQuote, registerCapture, regenerateQuote } from '../src/api/client';
import {
  assemblyReducer,
  createInitialAssemblyState,
  type AssemblyAction,
  type AssemblyState,
} from '../src/hooks/quoteAssemblyReducer';
import type { LineItemRow } from '../src/hooks/useLineItemSync';
import { groupTraces } from '../src/lib/traceGroups';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000';

const TEST_EMAIL = 'integration-test@quotelens.dev';
const SECOND_EMAIL = 'live-verify-b@quotelens.dev';
const JOB_MARKER = 'Live Verify Client';
const FIXTURES = resolve(__dirname, '../../backend/tests/fixtures');
const SEVEN_NODES = [
  'transcribe',
  'analyze_photos',
  'parse_walkthrough',
  'match_pricebook',
  'draft_line_items',
  'validate',
  'compile_quote',
];

// ---------------------------------------------------------------- helpers

let failures = 0;
const notes: string[] = [];

function check(name: string, ok: boolean, detail = ''): boolean {
  if (!ok) failures += 1;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

function note(msg: string): void {
  notes.push(msg);
  console.log(`[NOTE] ${msg}`);
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(fn: () => T | undefined, timeoutMs: number, label: string): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout after ${timeoutMs}ms: ${label}`);
    await sleep(150);
  }
}

function toArrayBuffer(b: Buffer): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

/** Mirror of the photo id shape in useCaptureSession.ts:283-284. */
function rand6(): string {
  return Math.random().toString(36).slice(2, 8).padEnd(6, '0');
}

function newUserClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: true },
  });
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function ensureUser(email: string) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const hit = data.users.find((u) => u.email === email);
    if (hit) return hit;
    if (data.users.length < 200) break;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    password: crypto.randomUUID(),
  });
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
  return data.user;
}

/**
 * Mint a genuine OTP via the admin API (no inbox needed), then verify it
 * through the exact client call the login screen makes (login.tsx:62-66).
 */
async function signInViaMintedOtp(client: SupabaseClient, email: string) {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw new Error(`generateLink ${email}: ${error.message}`);
  const otp = (data.properties as { email_otp?: string } | null)?.email_otp;
  if (!otp) throw new Error(`generateLink ${email}: no email_otp in properties`);
  let usedType = 'email';
  let res = await client.auth.verifyOtp({ email, token: otp, type: 'email' });
  if (res.error) {
    usedType = 'magiclink';
    res = await client.auth.verifyOtp({ email, token: otp, type: 'magiclink' });
  }
  if (res.error || !res.data.session) {
    throw new Error(`verifyOtp ${email}: ${res.error?.message ?? 'no session'}`);
  }
  return { session: res.data.session, user: res.data.session.user, usedType };
}

// ------------------------------------------------ assembly mirror (hook)

/** Mirrors useQuoteAssembly.ts:41-152 plus the reset-regenerate dispatch the
 *  review screen performs when quotes.status flips to 'generating'
 *  (app/quote/[quoteId]/index.tsx handleQuoteUpdate). */
async function startAssemblyMirror(
  client: SupabaseClient,
  quoteId: string,
  opts: { name: string; resetOnGenerating?: boolean },
) {
  let state: AssemblyState = createInitialAssemblyState();
  const dispatch = (a: AssemblyAction) => {
    state = assemblyReducer(state, a);
  };
  let liveEvents = 0;
  let liveTraces = 0;
  let historyFetches = 0;
  const liveEventLog: { id: number; event_type: string; at: number }[] = [];
  const quotesUpdates: Record<string, unknown>[] = [];

  // Mirror of fetchHistory, useQuoteAssembly.ts:65-93 (subscribe first, then
  // fetch, fold with live=false; runs on every SUBSCRIBED).
  const fetchHistory = async () => {
    const [traces, events] = await Promise.all([
      client
        .from('agent_traces')
        .select('node, created_at')
        .eq('quote_id', quoteId)
        .order('created_at', { ascending: true }),
      client
        .from('quote_events')
        .select('id, event_type, payload')
        .eq('quote_id', quoteId)
        .order('id', { ascending: true }),
    ]);
    for (const t of (traces.data ?? []) as { node: string }[]) {
      dispatch({ type: 'trace', node: t.node });
    }
    for (const e of (events.data ?? []) as { id: number | string; event_type: string; payload: unknown }[]) {
      dispatch({ type: 'event', id: Number(e.id), event_type: e.event_type, payload: e.payload, live: false });
    }
    historyFetches += 1;
  };

  // Mirror of the channel wiring, useQuoteAssembly.ts:95-143.
  const channel = client
    .channel(`quote-assembly-${quoteId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'quote_events', filter: `quote_id=eq.${quoteId}` },
      (payload: { new: Record<string, unknown> }) => {
        liveEvents += 1;
        liveEventLog.push({
          id: Number(payload.new.id),
          event_type: String(payload.new.event_type),
          at: Date.now(),
        });
        dispatch({
          type: 'event',
          id: Number(payload.new.id),
          event_type: String(payload.new.event_type),
          payload: payload.new.payload,
          live: true,
        });
      },
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'agent_traces', filter: `quote_id=eq.${quoteId}` },
      (payload: { new: Record<string, unknown> }) => {
        liveTraces += 1;
        dispatch({ type: 'trace', node: String(payload.new.node) });
      },
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'quotes', filter: `id=eq.${quoteId}` },
      (payload: { new: Record<string, unknown> }) => {
        quotesUpdates.push(payload.new);
        if (opts.resetOnGenerating && payload.new.status === 'generating') {
          dispatch({ type: 'reset-regenerate' });
        }
      },
    );

  await new Promise<void>((resolveSub, rejectSub) => {
    const timer = setTimeout(() => rejectSub(new Error(`${opts.name}: subscribe timeout`)), 15000);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer);
        void fetchHistory();
        resolveSub();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer);
        rejectSub(new Error(`${opts.name}: subscribe ${status}`));
      }
    });
  });

  return {
    get state() {
      return state;
    },
    get liveEvents() {
      return liveEvents;
    },
    get liveTraces() {
      return liveTraces;
    },
    get historyFetches() {
      return historyFetches;
    },
    liveEventLog,
    quotesUpdates,
    dispatch,
    waitPhase(phases: string[], timeoutMs: number) {
      return until(
        () => (phases.includes(state.phase) ? state : undefined),
        timeoutMs,
        `${opts.name}: phase ${phases.join('|')} (now '${state.phase}')`,
      );
    },
    waitQuoteStatus(status: string, timeoutMs: number) {
      return until(
        () => quotesUpdates.find((q) => q.status === status),
        timeoutMs,
        `${opts.name}: quotes UPDATE status=${status}`,
      );
    },
    close() {
      return client.removeChannel(channel);
    },
  };
}

// --------------------------------------------- line-items mirror (hook)

/** parseRow copied from useLineItemSync.ts:29-45 (numeric-over-realtime
 *  normalization must match the app exactly). */
function parseRow(raw: Record<string, unknown>): LineItemRow {
  return {
    id: String(raw.id),
    quote_id: String(raw.quote_id),
    description: String(raw.description ?? ''),
    quantity: Number(raw.quantity),
    unit: raw.unit as LineItemRow['unit'],
    unit_price_cents: raw.unit_price_cents == null ? null : Number(raw.unit_price_cents),
    total_cents: raw.total_cents == null ? null : Number(raw.total_cents),
    price_book_item_id: raw.price_book_item_id == null ? null : String(raw.price_book_item_id),
    photo_citations: Array.isArray(raw.photo_citations) ? raw.photo_citations.map(String) : [],
    confidence: raw.confidence as LineItemRow['confidence'],
    position: Number(raw.position ?? 0),
  };
}

function sortByPosition(rows: LineItemRow[]): LineItemRow[] {
  return [...rows].sort((a, b) => a.position - b.position);
}

/** sameContent copied from useLineItemSync.ts:52-63 (echo suppression). */
function sameContent(a: LineItemRow, b: LineItemRow): boolean {
  return (
    a.description === b.description &&
    a.quantity === b.quantity &&
    a.unit === b.unit &&
    a.unit_price_cents === b.unit_price_cents &&
    a.total_cents === b.total_cents &&
    a.price_book_item_id === b.price_book_item_id &&
    a.confidence === b.confidence &&
    a.photo_citations.join(' ') === b.photo_citations.join(' ')
  );
}

/** Mirrors useLineItemSync.ts:94-238: merge semantics, echo suppression via
 *  sameContent, unfiltered DELETE scoped client-side by PK. */
async function startLineItemsMirror(client: SupabaseClient, quoteId: string, name: string) {
  let rows: LineItemRow[] | null = null;
  const flashes: string[] = [];
  const rawInserts: { row: LineItemRow; at: number }[] = [];
  const rawUpdates: { row: LineItemRow; at: number }[] = [];
  const rawDeletes: { id: string; at: number }[] = [];

  const channel = client
    .channel(`quote-line-items-${quoteId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'quote_line_items', filter: `quote_id=eq.${quoteId}` },
      (payload: { new: Record<string, unknown> }) => {
        const incoming = parseRow(payload.new);
        rawInserts.push({ row: incoming, at: Date.now() });
        if (rows === null) return; // pre-hydration: useLineItemSync.ts:167-169
        if (rows.some((r) => r.id === incoming.id)) return;
        rows = sortByPosition([...rows, incoming]);
      },
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'quote_line_items', filter: `quote_id=eq.${quoteId}` },
      (payload: { new: Record<string, unknown> }) => {
        const incoming = parseRow(payload.new);
        rawUpdates.push({ row: incoming, at: Date.now() });
        if (rows === null) return;
        const existing = rows.find((r) => r.id === incoming.id);
        if (!existing) {
          rows = sortByPosition([...rows, incoming]);
          return;
        }
        if (sameContent(existing, incoming)) return; // local-save echo: no flash
        flashes.push(incoming.id);
        rows = rows.map((r) => (r.id === incoming.id ? incoming : r));
      },
    )
    .on(
      'postgres_changes',
      // Unfiltered by design: DELETE old records carry only the PK
      // (useLineItemSync.ts:206-229).
      { event: 'DELETE', schema: 'public', table: 'quote_line_items' },
      (payload: { old: Record<string, unknown> }) => {
        const oldId = payload.old?.id;
        if (oldId != null) {
          rawDeletes.push({ id: String(oldId), at: Date.now() });
          if (rows) rows = rows.filter((r) => r.id !== String(oldId));
        }
      },
    );

  await new Promise<void>((resolveSub, rejectSub) => {
    const timer = setTimeout(() => rejectSub(new Error(`${name}: subscribe timeout`)), 15000);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer);
        resolveSub();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer);
        rejectSub(new Error(`${name}: subscribe ${status}`));
      }
    });
  });

  return {
    get rows() {
      return rows;
    },
    flashes,
    rawInserts,
    rawUpdates,
    rawDeletes,
    // Mirror of refresh(), useLineItemSync.ts:110-127.
    async refresh(): Promise<LineItemRow[]> {
      const { data, error } = await client
        .from('quote_line_items')
        .select('*')
        .eq('quote_id', quoteId)
        .order('position', { ascending: true });
      if (error) throw new Error(`${name} refresh: ${error.message}`);
      rows = (data ?? []).map((raw) => parseRow(raw as Record<string, unknown>));
      return rows;
    },
    // Mirror of applyLocal(), useLineItemSync.ts:129-139.
    applyLocal(row: LineItemRow) {
      if (rows === null) return;
      rows = rows.some((r) => r.id === row.id)
        ? rows.map((r) => (r.id === row.id ? row : r))
        : sortByPosition([...rows, row]);
    },
    waitUpdate(id: string, timeoutMs: number) {
      return until(() => rawUpdates.find((u) => u.row.id === id), timeoutMs, `${name}: UPDATE for ${id}`);
    },
    waitDelete(id: string, timeoutMs: number) {
      return until(() => rawDeletes.find((d) => d.id === id), timeoutMs, `${name}: DELETE for ${id}`);
    },
    close() {
      return client.removeChannel(channel);
    },
  };
}

// ---------------------------------------------------------------- main

async function main() {
  section('S0 preflight');
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
    throw new Error('missing env: source the repo-root .env first (set -a && source ../.env && set +a)');
  }
  const health = await fetch(`${API_URL}/health`).then(
    (r) => r.status,
    () => 0,
  );
  if (!check('S0.1 uvicorn /health', health === 200, `${API_URL}/health -> ${health}`)) {
    throw new Error('backend is not running');
  }
  const wav = join(FIXTURES, 'voice-note.wav');
  const jpg1 = join(FIXTURES, 'photo-water-stain.jpg');
  const jpg2 = join(FIXTURES, 'photo-scuffed-wall.jpg');
  if (!check('S0.2 fixtures present', existsSync(wav) && existsSync(jpg1) && existsSync(jpg2), FIXTURES)) {
    throw new Error('fixtures missing');
  }
  // The app records AAC .m4a via expo-audio (useCaptureSession.ts:395); the
  // session-3 integration run only ever fed the pipeline WAV. Convert the
  // fixture so the pipeline sees exactly what a real capture produces.
  const m4a = join(tmpdir(), `quotelens-voice-note-${Date.now()}.m4a`);
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', wav, m4a]);
  check('S0.3 fixture converted to .m4a (app capture format)', existsSync(m4a), m4a);

  section('S1 auth — email OTP (verifyOtp mirror of login.tsx:62-66)');
  const userA = await ensureUser(TEST_EMAIL);
  const userB = await ensureUser(SECOND_EMAIL);
  const deviceA = newUserClient(); // "device 1" of user A
  const a = await signInViaMintedOtp(deviceA, TEST_EMAIL);
  check('S1.1 verifyOtp establishes a session (device A)', Boolean(a.session.access_token), `verifyOtp type='${a.usedType}', user ${a.user.id}`);
  check('S1.2 session user matches auth.users row', a.user.id === userA.id);
  const deviceB = newUserClient(); // "device 2" of user A (cross-device sync)
  const b = await signInViaMintedOtp(deviceB, TEST_EMAIL);
  check('S1.3 second device session (device B)', Boolean(b.session.access_token));
  const clientB = newUserClient(); // a DIFFERENT user, for RLS negatives
  const bb = await signInViaMintedOtp(clientB, SECOND_EMAIL);
  check('S1.4 second user session', bb.user.id === userB.id);
  const tokenA = a.session.access_token;
  const uid = userA.id;

  section('S2 job + price book (mirror of job/new.tsx + priceBooks.ts)');
  // Load pickable books — mirror job/new.tsx:57-61.
  const books = await deviceA
    .from('price_books')
    .select('*')
    .or(`is_template.eq.true,user_id.eq.${uid}`)
    .order('name');
  const bookRows = (books.data ?? []) as { id: string; name: string; trade: string; is_template: boolean; is_active: boolean; user_id: string | null }[];
  const trades = new Set(bookRows.filter((r) => r.is_template).map((r) => r.trade));
  check('S2.1 seeded template books visible', ['painting', 'hvac', 'landscaping'].every((t) => trades.has(t)), `templates: ${[...trades].join(', ')}`);
  // Activate painting — mirror of activatePriceBook, priceBooks.ts:85-120.
  const painting = bookRows.find((r) => r.is_template && r.trade === 'painting');
  if (!painting) throw new Error('painting template missing');
  const deact = await deviceA.from('price_books').update({ is_active: false }).eq('user_id', uid).eq('is_active', true);
  check('S2.2 deactivate owned active books (RLS update)', !deact.error, deact.error?.message ?? '');
  // painting template ships globally active: nothing else to do (priceBooks.ts:100-102)
  check('S2.3 painting template is the active book', painting.is_active === true);
  // Reuse or create the job — insert mirror of job/new.tsx:93-103.
  const existingJob = await deviceA.from('jobs').select('id').eq('client_name', JOB_MARKER).limit(1).maybeSingle();
  let jobId: string;
  if (existingJob.data) {
    jobId = (existingJob.data as { id: string }).id;
    note(`reusing job ${jobId} from a previous harness run`);
  } else {
    const ins = await deviceA
      .from('jobs')
      .insert({ user_id: uid, client_name: JOB_MARKER, address: '12 Demo Street', trade: 'painting', status: 'open' })
      .select('id')
      .single();
    if (ins.error || !ins.data) throw new Error(`job insert: ${ins.error?.message}`);
    jobId = (ins.data as { id: string }).id;
  }
  check('S2.4 job row created under RLS', Boolean(jobId), `job ${jobId}`);
  // Jobs list — mirror of useJobs.ts:76-79.
  const jobs = await deviceA.from('jobs').select('*, quotes(id, status, created_at)').order('created_at', { ascending: false });
  const jobRows = (jobs.data ?? []) as { id: string; user_id: string }[];
  check('S2.5 jobs list returns the new job', jobRows.some((j) => j.id === jobId));
  check('S2.6 every listed job belongs to user A (RLS scope)', jobRows.every((j) => j.user_id === uid), `${jobRows.length} rows`);

  section('S3 RLS negatives — tables (user B must see nothing of user A)');
  const bJobs = await clientB.from('jobs').select('id, user_id');
  check('S3.1 user B sees none of user A jobs', ((bJobs.data ?? []) as { user_id: string }[]).every((j) => j.user_id !== uid));
  const bJobById = await clientB.from('jobs').select('id').eq('id', jobId);
  check('S3.2 direct select of A job by id returns 0 rows', (bJobById.data ?? []).length === 0);

  section('S4 eager uploads (mirror of uploads.ts:15-33 + useCaptureSession sequencing)');
  const photoId1 = `photo-1-${rand6()}`;
  const photoId2 = `photo-2-${rand6()}`;
  const p1 = `${uid}/${jobId}/${photoId1}.jpg`;
  const p2 = `${uid}/${jobId}/${photoId2}.jpg`;
  const audioPath = `${uid}/${jobId}/audio-${Date.now()}.m4a`;
  const up1 = await deviceA.storage.from('captures').upload(p1, toArrayBuffer(readFileSync(jpg1)), { contentType: 'image/jpeg', upsert: true });
  const up2 = await deviceA.storage.from('captures').upload(p2, toArrayBuffer(readFileSync(jpg2)), { contentType: 'image/jpeg', upsert: true });
  check('S4.1 photo uploads to private captures bucket (user session)', !up1.error && !up2.error, up1.error?.message ?? up2.error?.message ?? `${p1}, ${p2}`);
  // Eager per-photo registration — mirror of useCaptureSession.ts:260-275.
  const reg1 = await registerCapture({ job_id: jobId, kind: 'photo', storage_path: p1 }, tokenA);
  const reg2 = await registerCapture({ job_id: jobId, kind: 'photo', storage_path: p2 }, tokenA);
  check('S4.2 POST /captures registers photos, row has id', typeof reg1.id === 'string' && reg1.id.length > 0 && typeof reg2.id === 'string', `ids ${reg1.id}, ${reg2.id}`);
  const upA = await deviceA.storage.from('captures').upload(audioPath, toArrayBuffer(readFileSync(m4a)), { contentType: 'audio/m4a', upsert: true });
  check('S4.3 audio .m4a upload (audio/m4a, app content type)', !upA.error, upA.error?.message ?? audioPath);
  const regA = await registerCapture({ job_id: jobId, kind: 'audio', storage_path: audioPath }, tokenA);
  check('S4.4 POST /captures registers audio', typeof regA.id === 'string' && regA.id.length > 0);
  // Signed URLs — mirror of photoThumbs.ts:31-33.
  const signed = await deviceA.storage.from('captures').createSignedUrls([p1, p2], 3600);
  const signedOk = !signed.error && (signed.data ?? []).every((s) => Boolean(s.signedUrl));
  check('S4.5 signed URLs for citation thumbnails', signedOk);
  if (signedOk && signed.data) {
    const bytes = await fetch(signed.data[0].signedUrl).then((r) => (r.ok ? r.arrayBuffer() : null));
    check('S4.6 signed URL serves the photo bytes', bytes !== null && bytes.byteLength === readFileSync(jpg1).byteLength, `${bytes?.byteLength ?? 0} bytes`);
  }

  section('S5 negatives — storage RLS + API ownership');
  const intrude = await deviceA.storage.from('captures').upload(`${userB.id}/${jobId}/intruder.jpg`, toArrayBuffer(readFileSync(jpg1)), { contentType: 'image/jpeg', upsert: true });
  check("S5.1 upload under another user's prefix rejected", Boolean(intrude.error), intrude.error?.message ?? 'UNEXPECTED SUCCESS');
  const steal = await clientB.storage.from('captures').download(p1);
  check("S5.2 user B cannot download A's object", Boolean(steal.error), steal.error?.message ?? 'UNEXPECTED SUCCESS');
  const forged = await registerCapture({ job_id: jobId, kind: 'photo', storage_path: `${userB.id}/x.jpg` }, tokenA).then(
    () => 'ok',
    (e: Error) => e.message,
  );
  check('S5.3 /captures rejects foreign storage_path (403)', forged.includes('403'), forged);
  const badJob = await registerCapture({ job_id: crypto.randomUUID(), kind: 'photo', storage_path: p1 }, tokenA).then(
    () => 'ok',
    (e: Error) => e.message,
  );
  check('S5.4 /captures rejects unowned job (404)', badJob.includes('404'), badJob);
  const noAuth = await fetch(`${API_URL}/captures`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId, kind: 'photo', storage_path: p1 }) });
  check('S5.5 /captures without JWT -> 401', noAuth.status === 401, `HTTP ${noAuth.status}`);

  section('S6 generate -> realtime live assembly (real pipeline, real events)');
  const tGen0 = Date.now();
  const gen = await generateQuote({ job_id: jobId, audio_path: audioPath, photos: [{ photo_id: photoId1, storage_path: p1 }, { photo_id: photoId2, storage_path: p2 }] }, tokenA);
  const quoteId = gen.quote_id;
  check('S6.1 POST /generate -> 202 with quote_id', Boolean(quoteId), `quote ${quoteId}, ${Date.now() - tGen0}ms to respond`);
  // Screen mounts after the 202 (capture -> replace -> review): subscribe now.
  const mirrorA = await startAssemblyMirror(deviceA, quoteId, { name: 'deviceA', resetOnGenerating: true });
  const itemsA = await startLineItemsMirror(deviceA, quoteId, 'deviceA-items');
  check('S6.2 realtime channels SUBSCRIBED (deviceA)', true);
  const finalA = await mirrorA.waitPhase(['completed', 'failed'], 300_000);
  const tGen = Date.now() - tGen0;
  console.log(`    pipeline finished in ${(tGen / 1000).toFixed(1)}s; phase=${finalA.phase}; live events=${mirrorA.liveEvents}, live traces=${mirrorA.liveTraces}, history fetches=${mirrorA.historyFetches}`);
  if (finalA.phase === 'failed') {
    console.log(`    generation_failed errors: ${JSON.stringify(finalA.failedErrors)}`);
  }
  check('S6.3 pipeline completed', finalA.phase === 'completed', `attempt ${finalA.attempt}`);
  check('S6.4 agent_traces INSERTs arrived over realtime (stage ticker)', mirrorA.liveTraces >= 1, `${mirrorA.liveTraces} live trace inserts`);
  // The compile_quote trace row is written by the @traced decorator AFTER
  // the node emits generation_completed, so give the last tick a moment.
  await until(
    () => (SEVEN_NODES.every((n) => mirrorA.state.stagesDone.includes(n)) ? true : undefined),
    8_000,
    'final stage tick',
  ).catch(() => undefined);
  check('S6.5 all seven stages ticked', SEVEN_NODES.every((n) => mirrorA.state.stagesDone.includes(n)), mirrorA.state.stagesDone.join(' -> '));
  check('S6.6 quote_events INSERTs arrived over realtime (live assembly)', mirrorA.liveEvents >= 1, `${mirrorA.liveEvents} live events`);
  const drafted = finalA.items;
  check('S6.7 drafted items assembled from events', drafted.length >= 1, `${drafted.length} items`);
  const liveSplit = `${drafted.filter((d) => d.live).length} live / ${drafted.filter((d) => !d.live).length} history`;
  check('S6.8 items arrived on the live channel (animate-live-only source)', drafted.some((d) => d.live), liveSplit);
  const citationsOk = drafted.every((d) => Array.isArray(d.item.photo_citations) && d.item.photo_citations.length >= 1 && d.item.photo_citations.every((c) => c === photoId1 || c === photoId2));
  check('S6.9 every drafted item cites only the uploaded photos', citationsOk, drafted.map((d) => `[${d.item.photo_citations.join(',')}]`).join(' '));
  check('S6.10 unpriced path exercised (blinds absent from book)', drafted.some((d) => d.item.unit_price_cents == null), drafted.map((d) => `${d.item.description.slice(0, 30)}:${d.item.unit_price_cents}`).join(' | '));
  const eventIds = mirrorA.liveEventLog.map((e) => e.id);
  check('S6.11 live events arrived in id order (emission order)', eventIds.every((id, i) => i === 0 || id > eventIds[i - 1]), eventIds.join(','));
  const completedUpdate = await mirrorA.waitQuoteStatus('completed', 10_000);
  check('S6.12 quotes UPDATE rode realtime (status completed + subtotal)', completedUpdate.subtotal_cents != null, `subtotal_cents=${completedUpdate.subtotal_cents}`);
  const dbRows = await itemsA.refresh();
  check('S6.13 DB rows match assembled items', dbRows.length === drafted.length, `${dbRows.length} rows vs ${drafted.length} drafted`);
  check('S6.14 DB rows all carry >=1 photo citation (hard invariant)', dbRows.every((r) => r.photo_citations.length >= 1));
  const dbSubtotal = dbRows.reduce((s, r) => s + (r.total_cents ?? 0), 0);
  check('S6.15 quotes.subtotal_cents equals sum of line totals', Number(completedUpdate.subtotal_cents) === dbSubtotal, `${completedUpdate.subtotal_cents} vs ${dbSubtotal}`);
  check('S6.16 line-items INSERTs rode realtime (cross-device channel)', itemsA.rawInserts.length >= dbRows.length, `${itemsA.rawInserts.length} inserts seen`);

  section('S7 catch-up rule (device B opens the finished quote)');
  const mirrorB = await startAssemblyMirror(deviceB, quoteId, { name: 'deviceB', resetOnGenerating: true });
  const itemsB = await startLineItemsMirror(deviceB, quoteId, 'deviceB-items');
  const caughtUp = await mirrorB.waitPhase(['completed'], 15_000);
  check('S7.1 history fold alone reaches completed', caughtUp.phase === 'completed');
  check('S7.2 zero live events needed for catch-up', mirrorB.liveEvents === 0, `${mirrorB.liveEvents} live`);
  check('S7.3 all caught-up items are live=false (no entry animation)', caughtUp.items.every((d) => !d.live), `${caughtUp.items.length} items`);
  check('S7.4 caught-up item set matches device A', caughtUp.items.length === drafted.length);
  await itemsB.refresh();

  section('S8 cross-device sync (SPEC goal: < 2s propagation)');
  const rowsNow = itemsB.rows ?? [];
  const priced = rowsNow.find((r) => r.unit_price_cents != null);
  if (!priced) throw new Error('no priced row to edit');
  // Edit on device A — mirror of handleSave, app/quote/[quoteId]/index.tsx:337-346.
  const newQty = priced.quantity + 1;
  const newTotal = priced.unit_price_cents == null ? null : Math.round(newQty * priced.unit_price_cents);
  const editedRow: LineItemRow = { ...priced, description: `${priced.description} (edited)`, quantity: newQty, total_cents: newTotal };
  itemsA.applyLocal(editedRow);
  const tEdit0 = Date.now();
  const upd = await deviceA
    .from('quote_line_items')
    .update({ description: editedRow.description, quantity: editedRow.quantity, unit: editedRow.unit, unit_price_cents: editedRow.unit_price_cents, total_cents: editedRow.total_cents })
    .eq('id', priced.id);
  check('S8.1 device-direct line edit under RLS', !upd.error, upd.error?.message ?? '');
  const seen = await itemsB.waitUpdate(priced.id, 5_000);
  const editLatency = seen.at - tEdit0;
  check('S8.2 remote edit reached device B in < 2s', editLatency < 2_000, `${editLatency}ms`);
  check('S8.3 device B flashed the remote edit', itemsB.flashes.includes(priced.id));
  await sleep(1_000); // allow device A to receive its own echo
  check('S8.4 device A did NOT flash its own echo (sameContent)', !itemsA.flashes.includes(priced.id), `A flashes: [${itemsA.flashes.join(',')}]`);
  // Delete on device A — mirror of handleDelete, index.tsx:362-365.
  const deletable = rowsNow.find((r) => r.id !== priced.id) ?? null;
  if (deletable) {
    const tDel0 = Date.now();
    const del = await deviceA.from('quote_line_items').delete().eq('id', deletable.id);
    check('S8.5 device-direct delete under RLS', !del.error, del.error?.message ?? '');
    const delSeen = await itemsB.waitDelete(deletable.id, 5_000);
    check('S8.6 DELETE reached device B (unfiltered PK-only listener)', true, `${delSeen.at - tDel0}ms`);
  } else {
    check('S8.5 delete sync', false, 'only one row; nothing deletable');
  }
  // Subtotal recompute — mirror of recomputeSubtotal, index.tsx:300-303.
  const remaining = await itemsA.refresh();
  const newSubtotal = remaining.reduce((s, r) => s + (r.total_cents ?? 0), 0);
  const subUpd = await deviceA.from('quotes').update({ subtotal_cents: newSubtotal }).eq('id', quoteId);
  check('S8.7 subtotal recompute persisted', !subUpd.error, `subtotal_cents=${newSubtotal}`);
  await until(() => mirrorB.quotesUpdates.find((q) => Number(q.subtotal_cents) === newSubtotal), 5_000, 'device B sees subtotal update');
  check('S8.8 device B received the quotes UPDATE', true);

  section('S9 regenerate (cached transcript+observations, wholesale replace)');
  const tracesBefore = await deviceA.from('agent_traces').select('node').eq('quote_id', quoteId);
  const countBefore = (node: string) => ((tracesBefore.data ?? []) as { node: string }[]).filter((t) => t.node === node).length;
  const transcribesBefore = countBefore('transcribe');
  const visionsBefore = countBefore('analyze_photos');
  // RLS realtime spies: user B + anon must receive NOTHING during the re-run.
  const spyB = await startAssemblyMirror(clientB, quoteId, { name: 'spyB' });
  let spyAnonFailed = false;
  let spyAnon: Awaited<ReturnType<typeof startAssemblyMirror>> | null = null;
  try {
    spyAnon = await startAssemblyMirror(createClient(SUPABASE_URL, ANON_KEY), quoteId, { name: 'spyAnon' });
  } catch (e) {
    spyAnonFailed = true;
    note(`anon realtime subscribe rejected outright: ${(e as Error).message}`);
  }
  const rowCountBeforeRegen = (itemsB.rows ?? []).length;
  const delBefore = itemsB.rawDeletes.length;
  const insBefore = itemsB.rawInserts.length;
  const tRegen0 = Date.now();
  const regen = await regenerateQuote(quoteId, tokenA);
  check('S9.1 POST /regenerate -> 202, same quote id', regen.quote_id === quoteId);
  // The status flip to 'generating' is the realtime signal that resets the
  // review screens (SPEC failed-state rule); wait for it so waitPhase below
  // observes the NEW run, not the stale completed state.
  await mirrorA.waitQuoteStatus('generating', 10_000);
  check('S9.1b quotes UPDATE (generating) reset the screens', mirrorA.state.items.length === 0 || mirrorA.state.phase !== 'completed', `phase=${mirrorA.state.phase}`);
  const regenFinal = await mirrorA.waitPhase(['completed', 'failed'], 180_000);
  const tRegen = Date.now() - tRegen0;
  console.log(`    regenerate finished in ${(tRegen / 1000).toFixed(1)}s; phase=${regenFinal.phase}`);
  check('S9.2 regenerate completed', regenFinal.phase === 'completed');
  check('S9.3 reset-regenerate cleared and re-streamed items', regenFinal.items.length >= 1 && regenFinal.items.every((d) => d.live), `${regenFinal.items.length} fresh live items`);
  const tracesAfter = await deviceA.from('agent_traces').select('node').eq('quote_id', quoteId);
  const countAfter = (node: string) => ((tracesAfter.data ?? []) as { node: string }[]).filter((t) => t.node === node).length;
  check('S9.4 transcribe NOT re-run (cached transcript)', countAfter('transcribe') === transcribesBefore, `${transcribesBefore} -> ${countAfter('transcribe')}`);
  check('S9.5 vision NOT re-run (cached observations)', countAfter('analyze_photos') === visionsBefore, `${visionsBefore} -> ${countAfter('analyze_photos')}`);
  check('S9.6 draft/validate/compile re-ran', countAfter('draft_line_items') > countBefore('draft_line_items') && countAfter('compile_quote') > countBefore('compile_quote'));
  check('S9.7 regenerate faster than full run (skipped whisper+vision)', tRegen < tGen, `${(tRegen / 1000).toFixed(1)}s vs ${(tGen / 1000).toFixed(1)}s`);
  await sleep(1_500); // let the replace DELETEs/INSERTs finish propagating
  const delDelta = itemsB.rawDeletes.length - delBefore;
  const insDelta = itemsB.rawInserts.length - insBefore;
  check('S9.8 wholesale replace visible on device B (DELETEs then INSERTs)', delDelta >= rowCountBeforeRegen && insDelta >= 1, `${delDelta} deletes, ${insDelta} inserts during regenerate`);
  check('S9.9 user B realtime spy received nothing (RLS on realtime)', spyB.liveEvents === 0 && spyB.liveTraces === 0 && spyB.quotesUpdates.length === 0, `events=${spyB.liveEvents} traces=${spyB.liveTraces} quotes=${spyB.quotesUpdates.length}`);
  check('S9.10 user B history fetch returned nothing (RLS on tables)', spyB.state.items.length === 0 && spyB.state.stagesDone.length === 0);
  if (spyAnon) {
    check('S9.11 anon realtime spy received nothing', spyAnon.liveEvents === 0 && spyAnon.liveTraces === 0, `events=${spyAnon.liveEvents} traces=${spyAnon.liveTraces}`);
  } else {
    check('S9.11 anon realtime blocked at subscribe', spyAnonFailed);
  }
  const dbAfterRegen = await itemsA.refresh();
  check('S9.12 DB consistent after regenerate', dbAfterRegen.length === regenFinal.items.length && dbAfterRegen.every((r) => r.photo_citations.length >= 1), `${dbAfterRegen.length} rows`);

  section('S10 send + accept (web Accept simulation -> realtime banner)');
  // Send — mirror of handleSend, index.tsx:401-404.
  const send = await deviceA.from('quotes').update({ status: 'sent' }).eq('id', quoteId);
  check('S10.1 status -> sent under RLS', !send.error, send.error?.message ?? '');
  // fetchQuote mirror — index.tsx:152-156.
  const q = await deviceA.from('quotes').select('id, job_id, status, share_token, subtotal_cents').eq('id', quoteId).single();
  const shareToken = (q.data as { share_token?: string } | null)?.share_token ?? '';
  check('S10.2 share_token present (48 hex)', /^[0-9a-f]{48}$/.test(shareToken), shareToken.slice(0, 12) + '…');
  await mirrorB.waitQuoteStatus('sent', 5_000);
  check('S10.3 device B saw status -> sent', true);
  // Accept — simulate exactly what web/app/api/accept will do (service role):
  // INSERT quote_events(quote_accepted) + UPDATE quotes.status -> accepted.
  let acceptShape = '{quote_id, event_type, payload}';
  let acceptIns = await admin.from('quote_events').insert({ quote_id: quoteId, event_type: 'quote_accepted', payload: {} }).select('id').single();
  if (acceptIns.error) {
    acceptShape = '{quote_id, user_id, event_type, payload}';
    acceptIns = await admin.from('quote_events').insert({ quote_id: quoteId, user_id: uid, event_type: 'quote_accepted', payload: {} }).select('id').single();
  }
  check('S10.4 quote_accepted event inserted (web-accept simulation)', !acceptIns.error, `insert shape ${acceptShape}`);
  note(`web accept route must insert quote_events with shape ${acceptShape}`);
  const acc = await admin.from('quotes').update({ status: 'accepted' }).eq('id', quoteId);
  check('S10.5 quotes.status -> accepted (service role)', !acc.error, acc.error?.message ?? '');
  await until(() => (mirrorA.state.accepted ? true : undefined), 5_000, 'device A accepted banner');
  check('S10.6 device A: quote_accepted arrived live (Accepted banner)', mirrorA.state.accepted);
  await until(() => (mirrorB.state.accepted ? true : undefined), 5_000, 'device B accepted banner');
  check('S10.7 device B: quote_accepted arrived live', mirrorB.state.accepted);
  await mirrorA.waitQuoteStatus('accepted', 5_000);
  check('S10.8 quotes UPDATE (accepted) rode realtime', true);

  section('S11 trace viewer (static fetch mirror of trace.tsx:130-136 + real groupTraces)');
  const traceRows = await deviceA
    .from('agent_traces')
    .select('node, duration_ms, input_tokens, output_tokens, input, output, created_at')
    .eq('quote_id', quoteId)
    .order('created_at', { ascending: true });
  const tr = (traceRows.data ?? []) as { node: string; duration_ms: number | null; input_tokens: number | null; output_tokens: number | null }[];
  check('S11.1 traces fetched', tr.length >= SEVEN_NODES.length, `${tr.length} rows`);
  const groups = groupTraces(tr);
  check('S11.2 regenerate renders as a second attempt group', groups.length >= 2, `${groups.length} groups: ${groups.map((g) => g.length).join('+')}`);
  check('S11.3 first attempt contains all seven nodes', SEVEN_NODES.every((n) => groups[0].some((t) => t.node === n)), groups[0].map((t) => t.node).join(' -> '));
  // duration must be a number (a null would render 'nullms'); 0ms is real
  // for the pure-python validate node.
  check('S11.4 every trace has a real duration (no nullms render)', tr.every((t) => typeof t.duration_ms === 'number' && t.duration_ms >= 0), tr.map((t) => `${t.node}:${t.duration_ms}ms`).join(' '));
  const llmNodes = ['analyze_photos', 'parse_walkthrough', 'draft_line_items'];
  const tokensOk = llmNodes.every((n) => groups[0].some((t) => t.node === n && (t.input_tokens ?? 0) > 0 && (t.output_tokens ?? 0) > 0));
  check('S11.5 LLM nodes carry token counts', tokensOk, groups[0].map((t) => `${t.node}:${t.input_tokens ?? '-'}/${t.output_tokens ?? '-'}`).join(' '));

  section('S12 real email-OTP send probe (SMTP reality check, non-fatal)');
  const probe = await newUserClient().auth.signInWithOtp({ email: TEST_EMAIL, options: { shouldCreateUser: true } });
  if (probe.error) {
    note(`signInWithOtp email send FAILED for ${TEST_EMAIL}: "${probe.error.message}" — expected with Supabase default SMTP (team-member addresses only, low hourly cap). Real-device login needs custom SMTP or a team-member email. The verifyOtp path itself is proven above.`);
  } else {
    note(`signInWithOtp accepted for ${TEST_EMAIL} — an OTP email was actually dispatched.`);
  }
  check('S12.1 signInWithOtp probe executed (see NOTE for outcome)', true, probe.error ? `error: ${probe.error.message}` : 'sent');

  // ------------------------------------------------------------- summary
  section('summary');
  await Promise.allSettled([mirrorA.close(), mirrorB.close(), itemsA.close(), itemsB.close(), spyB.close(), spyAnon?.close()]);
  console.log(`quote under test: ${quoteId} (job ${jobId})`);
  console.log(`full run ${(tGen / 1000).toFixed(1)}s, regenerate ${(tRegen / 1000).toFixed(1)}s`);
  for (const n of notes) console.log(`NOTE: ${n}`);
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\nFATAL: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(2);
});
