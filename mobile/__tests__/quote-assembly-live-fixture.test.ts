// Folds a REAL pipeline run through the assembly reducer. The fixture is a
// verbatim dump of quote_events and agent_traces from a live integration run
// against the hosted Supabase project (quote a6638a1a, 2026-07-07): Sonnet
// vision + Haiku text + whisper transcription, no mocks. If the reducer and
// the backend's event contract drift apart, this is where it shows up.

import {
  assemblyReducer,
  createInitialAssemblyState,
  type AssemblyAction,
  type AssemblyState,
} from '@/hooks/quoteAssemblyReducer';
import { quoteLineItemSchema } from '@/lib/quote-schema';
import { groupTraces } from '@/lib/traceGroups';

import fixture from './fixtures/live-quote-run.json';

interface FixtureEvent {
  id: number;
  event_type: string;
  payload: unknown;
}

interface FixtureTrace {
  node: string;
  duration_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  created_at: string;
}

const events = fixture.events as FixtureEvent[];
const traces = fixture.traces as FixtureTrace[];

const PIPELINE_NODES = [
  'transcribe',
  'analyze_photos',
  'parse_walkthrough',
  'match_pricebook',
  'draft_line_items',
  'validate',
  'compile_quote',
];

function foldHistory(): AssemblyState {
  let state = createInitialAssemblyState();
  for (const trace of traces) {
    state = assemblyReducer(state, { type: 'trace', node: trace.node });
  }
  for (const event of events) {
    const action: AssemblyAction = {
      type: 'event',
      id: event.id,
      event_type: event.event_type,
      payload: event.payload,
      live: false,
    };
    state = assemblyReducer(state, action);
  }
  return state;
}

describe('live pipeline run folds through the assembly reducer', () => {
  it('completes with one row per drafted event, none animated (history)', () => {
    const state = foldHistory();
    const draftedCount = events.filter(
      (event) => event.event_type === 'line_item_drafted',
    ).length;
    expect(state.phase).toBe('completed');
    expect(state.items).toHaveLength(draftedCount);
    expect(state.items.every((item) => !item.live)).toBe(true);
    expect(state.retracted).toHaveLength(0);
    expect(state.failedErrors).toHaveLength(0);
  });

  it('every drafted line parses as a QuoteLineItem with at least one citation', () => {
    const state = foldHistory();
    for (const drafted of state.items) {
      const parsed = quoteLineItemSchema.parse(drafted.item);
      expect(parsed.photo_citations.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('drafted totals sum to the subtotal the backend persisted', () => {
    const state = foldHistory();
    const completed = events.find(
      (event) => event.event_type === 'generation_completed',
    );
    const persisted = (
      completed?.payload as { quote: { subtotal_cents: number } }
    ).quote.subtotal_cents;
    const summed = state.items.reduce(
      (sum, drafted) => sum + (drafted.item.total_cents ?? 0),
      0,
    );
    expect(summed).toBe(persisted);
  });

  it('ticks all seven stages, in real arrival order (parallel fan-out first)', () => {
    const state = foldHistory();
    expect([...state.stagesDone].sort()).toEqual([...PIPELINE_NODES].sort());
    // The real run's fan-out landed analyze_photos before transcribe; the
    // ticker must follow arrival order, not a hardcoded sequence.
    expect(state.stagesDone).toEqual(traces.map((trace) => trace.node));
  });

  it('replaying the full history is a no-op (subscribe-first overlap)', () => {
    const first = foldHistory();
    let replayed = first;
    for (const event of events) {
      replayed = assemblyReducer(replayed, {
        type: 'event',
        id: event.id,
        event_type: event.event_type,
        payload: event.payload,
        live: true,
      });
    }
    expect(replayed).toEqual(first);
  });

  it('a clean single-attempt run groups into one trace attempt', () => {
    const groups = groupTraces(traces);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((trace) => trace.node)).toEqual(
      traces.map((trace) => trace.node),
    );
  });
});
