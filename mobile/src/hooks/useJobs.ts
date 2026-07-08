// Jobs list hook: one query pulls the user's jobs with their quotes so the
// home screen can badge each card (SPEC.md - Mobile UI/UX - Navigation and
// structure). RLS scopes rows to the signed-in user; no explicit user_id
// filter is needed on this direct-from-device read.

import { useCallback, useEffect, useRef, useState } from 'react';

import type { QuoteStatus } from '@/lib/quote-schema';
import { supabase } from '@/lib/supabase';

export interface JobQuoteSummary {
  id: string;
  status: QuoteStatus;
  created_at: string;
}

export interface JobListItem {
  id: string;
  client_name: string;
  address: string | null;
  trade: string;
  status: string;
  created_at: string;
  /** The job's most recent quote (by created_at), or null before generation. */
  latestQuote: JobQuoteSummary | null;
}

interface JobRow {
  id: string;
  client_name: string;
  address: string | null;
  trade: string;
  status: string;
  created_at: string;
  quotes: JobQuoteSummary[] | null;
}

function toListItem(row: JobRow): JobListItem {
  const quotes = row.quotes ?? [];
  let latestQuote: JobQuoteSummary | null = null;
  for (const quote of quotes) {
    if (
      latestQuote === null ||
      new Date(quote.created_at).getTime() > new Date(latestQuote.created_at).getTime()
    ) {
      latestQuote = quote;
    }
  }
  return {
    id: row.id,
    client_name: row.client_name,
    address: row.address,
    trade: row.trade,
    status: row.status,
    created_at: row.created_at,
    latestQuote,
  };
}

export interface UseJobsResult {
  jobs: JobListItem[];
  /** True until the first fetch settles; refetches never flip it back. */
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useJobs(): UseJobsResult {
  const [jobs, setJobs] = useState<JobListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const refetch = useCallback(async () => {
    const id = ++requestId.current;
    const { data, error: queryError } = await supabase
      .from('jobs')
      .select('*, quotes(id, status, created_at)')
      .order('created_at', { ascending: false });
    if (id !== requestId.current) {
      return; // A newer refetch is in flight; let its result win.
    }
    if (queryError) {
      setError(queryError.message);
    } else {
      setError(null);
      setJobs(((data ?? []) as JobRow[]).map(toListItem));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { jobs, loading, error, refetch };
}
