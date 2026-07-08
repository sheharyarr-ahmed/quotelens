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
 * Accept = INSERT quote_events(quote_accepted) + UPDATE quotes.status.
 * (SPEC: "Accept writes a quote_events row"; Verification #3 additionally
 * checks the status change.) The event insert shape and its realtime
 * delivery to open mobile screens are proven by the live harness (S10).
 * Idempotent: a second accept is a no-op — SPEC does not ask for duplicate
 * agreement records, and the event_type enum would happily allow them.
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
  if (quote.status === "accepted") {
    return { outcome: "already_accepted" };
  }
  // A link only exists once the estimator shared it (status 'sent'), but a
  // quote mid-generation or failed must never be acceptable.
  if (quote.status === "generating" || quote.status === "failed") {
    return { outcome: "not_acceptable", status: quote.status };
  }
  const { error: eventError } = await client
    .from("quote_events")
    .insert({ quote_id: quote.id, event_type: "quote_accepted", payload: {} });
  if (eventError) {
    throw new Error(`accept event insert failed: ${eventError.message}`);
  }
  const { error: statusError } = await client
    .from("quotes")
    .update({ status: "accepted" })
    .eq("id", quote.id);
  if (statusError) {
    throw new Error(`accept status update failed: ${statusError.message}`);
  }
  return { outcome: "accepted" };
}
