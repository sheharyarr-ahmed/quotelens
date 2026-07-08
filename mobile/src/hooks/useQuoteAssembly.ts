// Realtime lifecycle for one quote's live assembly (SPEC.md v1.3 - Mobile
// UI/UX - Live assembly). Subscribe FIRST, then fetch history, fold
// everything through the pure reducer; the reducer dedups the overlap by
// quote_events row id.
//
// Realtime auth note (verified against the installed @supabase packages):
// supabase-js 2.58 constructs RealtimeClient with an `accessToken` callback
// bound to the auth client, and RealtimeClient calls `_setAuthSafely` on
// connect and heartbeat, so the session JWT reaches the socket without a
// manual `supabase.realtime.setAuth(...)` call. Token refreshes are pushed
// through `_handleTokenChanged` on SIGNED_IN / TOKEN_REFRESHED.

import { useEffect, useReducer, useRef, type Dispatch } from 'react';

import { supabase } from '@/lib/supabase';

import {
  assemblyReducer,
  createInitialAssemblyState,
  type AssemblyAction,
  type AssemblyState,
} from './quoteAssemblyReducer';

interface QuoteEventRow {
  id: number | string;
  event_type: string;
  payload: unknown;
}

interface AgentTraceRow {
  node: string;
}

export interface QuoteRowChange {
  status?: string;
  share_token?: string;
  subtotal_cents?: number | null;
  [key: string]: unknown;
}

export function useQuoteAssembly(
  quoteId: string | undefined,
  onQuoteUpdate?: (row: QuoteRowChange) => void,
): { state: AssemblyState; dispatch: Dispatch<AssemblyAction> } {
  const [state, dispatch] = useReducer(
    assemblyReducer,
    undefined,
    createInitialAssemblyState,
  );

  // Ref so a new callback identity never tears down the channel.
  const onQuoteUpdateRef = useRef(onQuoteUpdate);
  useEffect(() => {
    onQuoteUpdateRef.current = onQuoteUpdate;
  }, [onQuoteUpdate]);

  useEffect(() => {
    if (!quoteId) {
      return;
    }
    let disposed = false;

    // Runs after every SUBSCRIBED (including reconnects, which covers any
    // gap while the socket was down). Replays are no-ops in the reducer.
    const fetchHistory = async () => {
      const [traces, events] = await Promise.all([
        supabase
          .from('agent_traces')
          .select('node, created_at')
          .eq('quote_id', quoteId)
          .order('created_at', { ascending: true }),
        supabase
          .from('quote_events')
          .select('id, event_type, payload')
          .eq('quote_id', quoteId)
          .order('id', { ascending: true }),
      ]);
      if (disposed) {
        return;
      }
      for (const trace of (traces.data ?? []) as AgentTraceRow[]) {
        dispatch({ type: 'trace', node: trace.node });
      }
      for (const event of (events.data ?? []) as QuoteEventRow[]) {
        dispatch({
          type: 'event',
          id: Number(event.id),
          event_type: event.event_type,
          payload: event.payload,
          live: false,
        });
      }
    };

    const channel = supabase
      .channel(`quote-assembly-${quoteId}`)
      .on<QuoteEventRow>(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'quote_events',
          filter: `quote_id=eq.${quoteId}`,
        },
        (payload) => {
          dispatch({
            type: 'event',
            id: Number(payload.new.id),
            event_type: payload.new.event_type,
            payload: payload.new.payload,
            live: true,
          });
        },
      )
      .on<AgentTraceRow>(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'agent_traces',
          filter: `quote_id=eq.${quoteId}`,
        },
        (payload) => {
          dispatch({ type: 'trace', node: payload.new.node });
        },
      )
      .on<QuoteRowChange>(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'quotes',
          filter: `id=eq.${quoteId}`,
        },
        (payload) => {
          onQuoteUpdateRef.current?.(payload.new);
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void fetchHistory();
        }
      });

    return () => {
      disposed = true;
      void supabase.removeChannel(channel);
    };
  }, [quoteId]);

  return { state, dispatch };
}
