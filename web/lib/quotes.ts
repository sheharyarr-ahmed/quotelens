// Server-only data access for the public quote page (SPEC.md - Data flow,
// auth, and access): "Share link is an unguessable token, not auth. The
// client quote page is public by design, scoped to one quote via a random
// share token." There is no client session, so reads/writes go through the
// service role — the anonymous analog of the backend's user_id scoping rule
// is: scope every query strictly by share_token and select only what the
// page renders.

import "server-only";

import { createClient } from "@supabase/supabase-js";

export interface QuoteLineItemRow {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  unit_price_cents: number | null;
  total_cents: number | null;
  position: number;
}

export interface QuoteForClient {
  id: string;
  status: string;
  subtotal_cents: number | null;
  created_at: string;
  job: { client_name: string; trade: string } | null;
  line_items: QuoteLineItemRow[];
}

function serviceClient() {
  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (source the repo-root .env)",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function fetchQuoteByShareToken(
  shareToken: string,
): Promise<QuoteForClient | null> {
  const { data, error } = await serviceClient()
    .from("quotes")
    .select(
      "id, status, subtotal_cents, created_at, jobs(client_name, trade), quote_line_items(id, description, quantity, unit, unit_price_cents, total_cents, position)",
    )
    .eq("share_token", shareToken)
    .maybeSingle();
  if (error) {
    throw new Error(`quote lookup failed: ${error.message}`);
  }
  if (!data) {
    return null;
  }
  const job = Array.isArray(data.jobs) ? (data.jobs[0] ?? null) : data.jobs;
  const items = ((data.quote_line_items ?? []) as QuoteLineItemRow[])
    .slice()
    .sort((a, b) => a.position - b.position);
  return {
    id: data.id,
    status: data.status,
    subtotal_cents: data.subtotal_cents,
    created_at: data.created_at,
    job,
    line_items: items,
  };
}

export type AcceptResult =
  | { outcome: "accepted" }
  | { outcome: "already_accepted" }
  | { outcome: "not_acceptable"; status: string }
  | { outcome: "not_found" };

/**
 * Accept = UPDATE quotes.status + INSERT quote_events(quote_accepted).
 * (SPEC: "Accept writes a quote_events row"; Verification #3 additionally
 * checks the status change.) The event's realtime delivery to open mobile
 * screens is proven by the live harness (S10).
 *
 * Only a 'sent' quote is acceptable: the share link goes out at send, and a
 * pre-send 'completed' quote is still mutable on the estimator's device —
 * exactly the "accept a quote still mutating under them" state SPEC's send
 * design exists to prevent.
 *
 * Concurrency: the flip is a conditional UPDATE (WHERE status='sent'), so
 * of N simultaneous accepts exactly one wins and writes the event; the
 * partial unique index quote_events_one_accept_per_quote backstops the
 * one-agreement-record invariant at the DB layer (23505 = already written).
 */
export async function acceptQuoteByShareToken(
  shareToken: string,
): Promise<AcceptResult> {
  const client = serviceClient();
  const { data: quote, error } = await client
    .from("quotes")
    .select("id, status")
    .eq("share_token", shareToken)
    .maybeSingle();
  if (error) {
    throw new Error(`quote lookup failed: ${error.message}`);
  }
  if (!quote) {
    return { outcome: "not_found" };
  }

  const { data: flipped, error: flipError } = await client
    .from("quotes")
    .update({ status: "accepted" })
    .eq("id", quote.id)
    .eq("status", "sent")
    .select("id");
  if (flipError) {
    throw new Error(`accept status update failed: ${flipError.message}`);
  }

  if ((flipped ?? []).length === 0) {
    const { data: current, error: currentError } = await client
      .from("quotes")
      .select("status")
      .eq("id", quote.id)
      .maybeSingle();
    if (currentError) {
      throw new Error(`quote re-read failed: ${currentError.message}`);
    }
    if (current?.status === "accepted") {
      // Self-heals a lost event from an earlier interrupted accept, but
      // only when it is actually missing — a racing loser must not double
      // up the winner's insert.
      const { data: existing, error: existingError } = await client
        .from("quote_events")
        .select("id")
        .eq("quote_id", quote.id)
        .eq("event_type", "quote_accepted")
        .limit(1);
      if (existingError) {
        throw new Error(`accept event lookup failed: ${existingError.message}`);
      }
      if ((existing ?? []).length === 0) {
        await recordAcceptedEvent(client, quote.id);
      }
      return { outcome: "already_accepted" };
    }
    return { outcome: "not_acceptable", status: current?.status ?? quote.status };
  }

  await recordAcceptedEvent(client, quote.id);
  return { outcome: "accepted" };
}

async function recordAcceptedEvent(
  client: ReturnType<typeof serviceClient>,
  quoteId: string,
): Promise<void> {
  const { error } = await client
    .from("quote_events")
    .insert({ quote_id: quoteId, event_type: "quote_accepted", payload: {} });
  if (error && error.code !== "23505") {
    throw new Error(`accept event insert failed: ${error.message}`);
  }
}
