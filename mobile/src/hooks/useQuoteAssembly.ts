// Live assembly hook: subscribes to postgres_changes on quote_events and
// folds line_item_drafted / retry_started / generation_* events into the
// review screen's list state. Implemented next milestone.

export type AssemblyPhase = 'idle' | 'assembling' | 'revising' | 'done' | 'failed';

export interface QuoteAssemblyState {
  phase: AssemblyPhase;
}

export function useQuoteAssembly(quoteId: string): QuoteAssemblyState {
  void quoteId;
  return { phase: 'idle' };
}
