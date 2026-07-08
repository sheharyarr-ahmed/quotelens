// Pure attempt-grouping for the agent trace viewer (SPEC.md - Mobile UI/UX -
// Trace viewer). No React Native imports: the screen and Jest both consume
// this module directly.

/** Minimal shape groupTraces needs; the screen's full row extends it. */
export interface TraceNode {
  node: string;
}

/**
 * The agent_traces columns the trace screen selects (mirror of the DB row
 * minus id/quote_id; input/output are opaque jsonb payloads).
 */
export interface AgentTraceRow extends TraceNode {
  duration_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  input: unknown;
  output: unknown;
  created_at: string;
}

/** One attempt's traces, preserving created_at order. */
export type TraceGroup<T extends TraceNode> = T[];

/**
 * Splits an ordered (created_at asc) trace list into attempt groups: a new
 * group starts whenever an incoming node name already exists in the current
 * group. This single rule covers both the validate -> draft_line_items retry
 * loop (splits at the second draft_line_items) and a full regenerate re-run
 * (splits at the repeated transcribe), with no attempt markers in the data.
 */
export function groupTraces<T extends TraceNode>(
  traces: readonly T[],
): TraceGroup<T>[] {
  const groups: TraceGroup<T>[] = [];
  let current: TraceGroup<T> = [];
  let seen = new Set<string>();

  for (const trace of traces) {
    if (seen.has(trace.node)) {
      groups.push(current);
      current = [];
      seen = new Set<string>();
    }
    current.push(trace);
    seen.add(trace.node);
  }
  if (current.length > 0) {
    groups.push(current);
  }
  return groups;
}
