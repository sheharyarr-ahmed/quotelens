// Unit tests for the pure live-assembly reducer (SPEC.md v1.3 - Mobile
// UI/UX - Live assembly). Covers ordering, dedup by event id, the happy
// path, the retry path, the failed path with row-index extraction,
// history-vs-live entry flags, quote_accepted, and the reset-regenerate
// watermark behavior.

import type { QuoteLineItem } from '../src/lib/quote-schema';
import {
  assemblyReducer,
  createInitialAssemblyState,
  extractRowErrors,
  type AssemblyAction,
  type AssemblyState,
} from '../src/hooks/quoteAssemblyReducer';

const NODES = [
  'transcribe',
  'analyze_photos',
  'parse_walkthrough',
  'match_pricebook',
  'draft_line_items',
  'validate',
  'compile_quote',
];

function lineItem(overrides: Partial<QuoteLineItem> = {}): QuoteLineItem {
  return {
    description: 'Demo demo wall',
    quantity: 120,
    unit: 'sqft',
    price_book_item_id: null,
    unit_price_cents: 450,
    total_cents: 54000,
    photo_citations: ['photo-1-ab12'],
    confidence: 'stated',
    ...overrides,
  };
}

function drafted(
  id: number,
  live = true,
  overrides: Partial<QuoteLineItem> = {},
): AssemblyAction {
  return {
    type: 'event',
    id,
    event_type: 'line_item_drafted',
    payload: { index: 0, line_item: lineItem(overrides) },
    live,
  };
}

function fold(state: AssemblyState, actions: AssemblyAction[]): AssemblyState {
  return actions.reduce(assemblyReducer, state);
}

describe('assemblyReducer', () => {
  test('initial state starts in loading with nothing folded', () => {
    const state = createInitialAssemblyState();
    expect(state.phase).toBe('loading');
    expect(state.items).toEqual([]);
    expect(state.retracted).toEqual([]);
    expect(state.stagesDone).toEqual([]);
    expect(state.attempt).toBe(1);
    expect(state.accepted).toBe(false);
    expect(state.seenEventIds).toEqual([]);
  });

  test('first trace moves loading -> waiting and ticks the stage', () => {
    const state = assemblyReducer(createInitialAssemblyState(), {
      type: 'trace',
      node: 'transcribe',
    });
    expect(state.phase).toBe('waiting');
    expect(state.stagesDone).toEqual(['transcribe']);
  });

  test('traces dedup by node name and preserve arrival order', () => {
    const state = fold(createInitialAssemblyState(), [
      { type: 'trace', node: 'analyze_photos' },
      { type: 'trace', node: 'transcribe' },
      { type: 'trace', node: 'transcribe' },
    ]);
    expect(state.stagesDone).toEqual(['analyze_photos', 'transcribe']);
  });

  test('events dedup by id: subscribe-first + history fetch overlap folds once', () => {
    const live = drafted(11, true);
    const replayFromHistory: AssemblyAction = {
      type: 'event',
      id: 11,
      event_type: 'line_item_drafted',
      payload: { index: 0, line_item: lineItem() },
      live: false,
    };
    const state = fold(createInitialAssemblyState(), [live, replayFromHistory]);
    expect(state.items).toHaveLength(1);
    expect(state.items[0].key).toBe('evt-11');
    expect(state.items[0].live).toBe(true);
    expect(state.seenEventIds).toEqual([11]);
  });

  test('history events fold with live=false so they render without entry motion', () => {
    const state = fold(createInitialAssemblyState(), [
      drafted(1, false),
      drafted(2, true),
    ]);
    expect(state.items.map((item) => item.live)).toEqual([false, true]);
  });

  test('full happy path: 7 traces + N drafted + completed', () => {
    const traces: AssemblyAction[] = NODES.map((node) => ({
      type: 'trace',
      node,
    }));
    let state = fold(createInitialAssemblyState(), traces.slice(0, 4));
    expect(state.phase).toBe('waiting');
    expect(state.stagesDone).toEqual(NODES.slice(0, 4));

    state = fold(state, [drafted(1), drafted(2), drafted(3)]);
    expect(state.phase).toBe('assembling');
    expect(state.items.map((item) => item.key)).toEqual([
      'evt-1',
      'evt-2',
      'evt-3',
    ]);

    state = fold(state, traces.slice(4));
    expect(state.stagesDone).toEqual(NODES);

    state = assemblyReducer(state, {
      type: 'event',
      id: 4,
      event_type: 'generation_completed',
      payload: {
        quote: { id: 'q-1', job_id: 'j-1', status: 'completed', line_items: [], subtotal_cents: 162000 },
      },
      live: true,
    });
    expect(state.phase).toBe('completed');
    expect(state.items).toHaveLength(3);
    expect(state.retracted).toEqual([]);
    expect(state.seenEventIds).toEqual([1, 2, 3, 4]);
  });

  test('retry path: drafted x2 -> retry_started -> re-drafted -> completed clears retracted', () => {
    let state = fold(createInitialAssemblyState(), [drafted(1), drafted(2)]);
    expect(state.phase).toBe('assembling');

    state = assemblyReducer(state, {
      type: 'event',
      id: 3,
      event_type: 'retry_started',
      payload: { attempt: 2, errors: ['line_items[1].photo_citations: List should have at least 1 item after validation, not 0'] },
      live: true,
    });
    expect(state.phase).toBe('revising');
    expect(state.attempt).toBe(2);
    expect(state.items).toEqual([]);
    expect(state.retracted.map((item) => item.key)).toEqual(['evt-1', 'evt-2']);

    state = fold(state, [drafted(4), drafted(5)]);
    expect(state.phase).toBe('revising');
    expect(state.items.map((item) => item.key)).toEqual(['evt-4', 'evt-5']);
    expect(state.retracted).toHaveLength(2);

    state = assemblyReducer(state, {
      type: 'event',
      id: 6,
      event_type: 'generation_completed',
      payload: { quote: { id: 'q-1', job_id: 'j-1', status: 'completed', line_items: [], subtotal_cents: 100 } },
      live: true,
    });
    expect(state.phase).toBe('completed');
    expect(state.retracted).toEqual([]);
    expect(state.items).toHaveLength(2);
  });

  test('retry_started without a numeric attempt bumps the local attempt', () => {
    const state = fold(createInitialAssemblyState(), [
      drafted(1),
      { type: 'event', id: 2, event_type: 'retry_started', payload: {}, live: true },
    ]);
    expect(state.attempt).toBe(2);
  });

  test('failed path keeps drafted rows and exposes errors', () => {
    const errors = [
      "line_items[0]: citation 'photo-x' does not refer to an analyzed photo",
      'line_items[2].photo_citations: List should have at least 1 item after validation, not 0',
      'subtotal_cents: value mismatch',
    ];
    const state = fold(createInitialAssemblyState(), [
      drafted(1),
      drafted(2),
      drafted(3),
      { type: 'event', id: 4, event_type: 'generation_failed', payload: { errors }, live: true },
    ]);
    expect(state.phase).toBe('failed');
    expect(state.failedErrors).toEqual(errors);
    expect(state.items).toHaveLength(3);
    expect(state.retracted).toEqual([]);
  });

  test('extractRowErrors maps line_items[i] errors to row indices', () => {
    const rowErrors = extractRowErrors([
      "line_items[0]: citation 'photo-x' does not refer to an analyzed photo",
      'line_items[2].photo_citations: List should have at least 1 item after validation, not 0',
      'line_items[2]: quantity must be positive',
      'subtotal_cents: value mismatch',
    ]);
    expect(rowErrors.get(0)).toBe(
      "line_items[0]: citation 'photo-x' does not refer to an analyzed photo",
    );
    expect(rowErrors.get(2)).toBe(
      'line_items[2].photo_citations: List should have at least 1 item after validation, not 0' +
        '\nline_items[2]: quantity must be positive',
    );
    expect(rowErrors.has(1)).toBe(false);
    expect(rowErrors.size).toBe(2);
  });

  test('quote_accepted flips accepted without touching the phase', () => {
    const state = fold(createInitialAssemblyState(), [
      drafted(1),
      { type: 'event', id: 2, event_type: 'generation_completed', payload: {}, live: true },
      { type: 'event', id: 3, event_type: 'quote_accepted', payload: {}, live: true },
    ]);
    expect(state.accepted).toBe(true);
    expect(state.phase).toBe('completed');
  });

  test('hydrate-completed jumps straight to completed (reopen a finished quote)', () => {
    const state = assemblyReducer(createInitialAssemblyState(), {
      type: 'hydrate-completed',
    });
    expect(state.phase).toBe('completed');
    expect(state.items).toEqual([]);
  });

  test('unknown event types consume their id but change nothing else', () => {
    const before = fold(createInitialAssemblyState(), [drafted(1)]);
    const after = assemblyReducer(before, {
      type: 'event',
      id: 9,
      event_type: 'somebody_elses_event',
      payload: {},
      live: true,
    });
    expect(after.items).toEqual(before.items);
    expect(after.phase).toBe(before.phase);
    expect(after.seenEventIds).toEqual([1, 9]);
  });

  test('line_item_drafted with a malformed payload consumes the id and appends nothing', () => {
    const state = assemblyReducer(createInitialAssemblyState(), {
      type: 'event',
      id: 5,
      event_type: 'line_item_drafted',
      payload: { index: 0 },
      live: true,
    });
    expect(state.items).toEqual([]);
    expect(state.seenEventIds).toEqual([5]);
  });

  test('reset-regenerate clears the run but keeps the id watermark', () => {
    const failedRun = fold(createInitialAssemblyState(), [
      { type: 'trace', node: 'transcribe' },
      { type: 'trace', node: 'analyze_photos' },
      drafted(1),
      drafted(2),
      { type: 'event', id: 3, event_type: 'generation_failed', payload: { errors: ['line_items[0]: bad citation'] }, live: true },
      { type: 'event', id: 4, event_type: 'quote_accepted', payload: {}, live: true },
    ]);

    const reset = assemblyReducer(failedRun, { type: 'reset-regenerate' });
    expect(reset.phase).toBe('waiting');
    expect(reset.stagesDone).toEqual([]);
    expect(reset.attempt).toBe(1);
    expect(reset.items).toEqual([]);
    expect(reset.retracted).toEqual([]);
    expect(reset.failedErrors).toEqual([]);
    expect(reset.accepted).toBe(false);
    // Watermark retained: ids 1-4 stay consumed.
    expect(reset.seenEventIds).toEqual([1, 2, 3, 4]);

    // History refetch replays the old run: every event is a no-op.
    const replayed = fold(reset, [
      drafted(1, false),
      drafted(2, false),
      { type: 'event', id: 3, event_type: 'generation_failed', payload: { errors: ['line_items[0]: bad citation'] }, live: false },
    ]);
    expect(replayed.phase).toBe('waiting');
    expect(replayed.items).toEqual([]);
    expect(replayed.failedErrors).toEqual([]);

    // Only the fresh run's higher ids fold.
    const freshRun = fold(replayed, [
      { type: 'trace', node: 'draft_line_items' },
      drafted(5),
      { type: 'event', id: 6, event_type: 'generation_completed', payload: {}, live: true },
    ]);
    expect(freshRun.phase).toBe('completed');
    expect(freshRun.items.map((item) => item.key)).toEqual(['evt-5']);
    expect(freshRun.seenEventIds).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test('cold open mid-regenerate: drafted after failed starts a fresh run', () => {
    // Fresh mount (empty watermark) of a quote whose history spans a failed
    // run and an in-flight regenerate: the failed run must not duplicate
    // into the new run's rows.
    const state = fold(createInitialAssemblyState(), [
      drafted(1, false),
      drafted(2, false),
      {
        type: 'event',
        id: 3,
        event_type: 'generation_failed',
        payload: { errors: ['line_items[0]: bad citation'] },
        live: false,
      },
      drafted(4, false),
      drafted(5, false),
      { type: 'event', id: 6, event_type: 'generation_completed', payload: {}, live: false },
    ]);
    expect(state.phase).toBe('completed');
    expect(state.items.map((item) => item.key)).toEqual(['evt-4', 'evt-5']);
    expect(state.failedErrors).toEqual([]);
    expect(state.seenEventIds).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test('folding is order-tolerant: a live event landing before history still dedups', () => {
    // Live event id 7 arrives first (subscription), then history replays 5-7.
    const state = fold(createInitialAssemblyState(), [
      drafted(7, true),
      drafted(5, false),
      drafted(6, false),
      drafted(7, false),
    ]);
    expect(state.items.map((item) => item.key)).toEqual([
      'evt-7',
      'evt-5',
      'evt-6',
    ]);
    expect(state.items.map((item) => item.live)).toEqual([true, false, false]);
    expect(state.seenEventIds).toEqual([7, 5, 6]);
  });
});
