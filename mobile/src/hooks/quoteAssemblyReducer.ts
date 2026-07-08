// Pure event-folding reducer for the live quote assembly screen
// (SPEC.md v1.3 - Mobile UI/UX - Live assembly). No react or react-native
// imports: the module is unit-tested under plain jest.
//
// Catch-up rule: the hook subscribes to realtime FIRST, then fetches
// quote_events history, so the two sources overlap. Every event action
// carries the quote_events row id and the reducer dedups by id membership.
// Because quote_events.id is a monotonically increasing identity column,
// keeping seenEventIds across a regenerate acts as the watermark: a history
// refetch that replays the old run's events is a no-op while the new run's
// higher ids fold normally.

import type { QuoteLineItem } from '../lib/quote-schema';

export type AssemblyPhase =
  | 'loading'
  | 'waiting'
  | 'assembling'
  | 'revising'
  | 'completed'
  | 'failed';

export interface DraftedItem {
  /** Stable render key derived from the quote_events row id. */
  key: string;
  item: QuoteLineItem;
  /** True only for events that arrived on the live channel; history
   *  recovery folds with live=false so rows render without entry motion. */
  live: boolean;
}

export interface AssemblyState {
  phase: AssemblyPhase;
  /** agent_traces node names, in arrival order (drives the stage ticker). */
  stagesDone: string[];
  attempt: number;
  items: DraftedItem[];
  /** Previous attempt's rows while a retry streams corrections. */
  retracted: DraftedItem[];
  failedErrors: string[];
  accepted: boolean;
  seenEventIds: number[];
}

export type AssemblyAction =
  | {
      type: 'event';
      id: number;
      event_type: string;
      payload: unknown;
      live: boolean;
    }
  | { type: 'trace'; node: string }
  | { type: 'hydrate-completed' }
  | { type: 'reset-regenerate' };

export function createInitialAssemblyState(): AssemblyState {
  return {
    phase: 'loading',
    stagesDone: [],
    attempt: 1,
    items: [],
    retracted: [],
    failedErrors: [],
    accepted: false,
    seenEventIds: [],
  };
}

/**
 * Maps generation_failed error strings to the drafted-row index they name.
 * Backend errors look like
 *   "line_items[2].photo_citations: List should have at least 1 item..."
 *   "line_items[0]: citation 'photo-x' does not refer to an analyzed photo"
 * Errors that do not name a row (whole-quote problems) are skipped here and
 * shown in the failure banner instead.
 */
export function extractRowErrors(errors: string[]): Map<number, string> {
  const byRow = new Map<number, string>();
  for (const error of errors) {
    const match = /^line_items\[(\d+)\]/.exec(error);
    if (match) {
      const index = Number(match[1]);
      const existing = byRow.get(index);
      byRow.set(index, existing ? `${existing}\n${error}` : error);
    }
  }
  return byRow;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function assemblyReducer(
  state: AssemblyState,
  action: AssemblyAction,
): AssemblyState {
  switch (action.type) {
    case 'trace': {
      const stagesDone = state.stagesDone.includes(action.node)
        ? state.stagesDone
        : [...state.stagesDone, action.node];
      const phase = state.phase === 'loading' ? 'waiting' : state.phase;
      if (stagesDone === state.stagesDone && phase === state.phase) {
        return state;
      }
      return { ...state, stagesDone, phase };
    }

    case 'hydrate-completed':
      // Opening an already-finished quote: show the settled quote at once
      // and skip assembly motion entirely.
      return { ...state, phase: 'completed', retracted: [], failedErrors: [] };

    case 'reset-regenerate':
      // seenEventIds is intentionally retained (watermark, see header note)
      // so the old run's events never fold into the fresh run.
      return {
        ...state,
        phase: 'waiting',
        stagesDone: [],
        attempt: 1,
        items: [],
        retracted: [],
        failedErrors: [],
        accepted: false,
      };

    case 'event': {
      if (state.seenEventIds.includes(action.id)) {
        return state;
      }
      const seenEventIds = [...state.seenEventIds, action.id];
      const payload: Record<string, unknown> = isRecord(action.payload)
        ? action.payload
        : {};

      switch (action.event_type) {
        case 'line_item_drafted': {
          const lineItem = isRecord(payload.line_item)
            ? (payload.line_item as unknown as QuoteLineItem)
            : null;
          if (!lineItem) {
            return { ...state, seenEventIds };
          }
          const drafted: DraftedItem = {
            key: `evt-${action.id}`,
            item: lineItem,
            live: action.live,
          };
          // A drafted event landing while the quote is failed marks a fresh
          // regenerate run. This covers the cold open of a regenerating quote
          // (empty watermark, history holds the failed run AND the new run):
          // the failed run's rows and errors are replaced, not appended to.
          const freshRun = state.phase === 'failed';
          return {
            ...state,
            seenEventIds,
            items: freshRun ? [drafted] : [...state.items, drafted],
            failedErrors: freshRun ? [] : state.failedErrors,
            phase: state.phase === 'revising' ? 'revising' : 'assembling',
          };
        }

        case 'retry_started': {
          const attempt =
            typeof payload.attempt === 'number'
              ? payload.attempt
              : state.attempt + 1;
          return {
            ...state,
            seenEventIds,
            phase: 'revising',
            attempt,
            retracted: [...state.retracted, ...state.items],
            items: [],
          };
        }

        case 'generation_completed':
          return {
            ...state,
            seenEventIds,
            phase: 'completed',
            retracted: [],
            failedErrors: [],
          };

        case 'generation_failed': {
          const errors = Array.isArray(payload.errors)
            ? payload.errors.filter(
                (error): error is string => typeof error === 'string',
              )
            : [];
          return {
            ...state,
            seenEventIds,
            phase: 'failed',
            failedErrors: errors,
            retracted: [],
          };
        }

        case 'quote_accepted':
          return { ...state, seenEventIds, accepted: true };

        default:
          // Unknown event types still consume their id so a later replay
          // stays a no-op.
          return { ...state, seenEventIds };
      }
    }
  }
}
