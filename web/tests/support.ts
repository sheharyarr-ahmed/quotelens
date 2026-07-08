// Shared service-role access for test seeding and DB assertions. Tests hit
// the live Supabase project: the fixture rows mirror exactly what the
// pipeline's save_completed writes (photo_citations non-empty per the DB
// check constraint; one unpriced row for the null-price path).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const TEST_EMAIL = "integration-test@quotelens.dev";
export const JOB_MARKER = "Playwright Client";

export function serviceClient(): SupabaseClient {
  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error(
      "Playwright needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY: run `set -a && source ../.env && set +a` first",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function ensureUser(client: SupabaseClient): Promise<string> {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const hit = data.users.find((u) => u.email === TEST_EMAIL);
    if (hit) return hit.id;
    if (data.users.length < 200) break;
  }
  const { data, error } = await client.auth.admin.createUser({
    email: TEST_EMAIL,
    email_confirm: true,
    password: crypto.randomUUID(),
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  return data.user.id;
}

export interface SeededQuote {
  id: string;
  shareToken: string;
}

export async function seedQuote(
  client: SupabaseClient,
  userId: string,
  jobId: string,
): Promise<SeededQuote> {
  const { data: quote, error } = await client
    .from("quotes")
    .insert({
      user_id: userId,
      job_id: jobId,
      status: "sent",
      subtotal_cents: 16100,
    })
    .select("id, share_token")
    .single();
  if (error || !quote) throw new Error(`quote insert: ${error?.message}`);
  const items = [
    {
      description: "Treat ceiling water stain",
      quantity: 1,
      unit: "flat",
      unit_price_cents: 8500,
      total_cents: 8500,
      position: 0,
    },
    {
      description: "Apply stain blocking primer",
      quantity: 80,
      unit: "sqft",
      unit_price_cents: 95,
      total_cents: 7600,
      position: 1,
    },
    {
      description: "Replace window blinds",
      quantity: 1,
      unit: "each",
      unit_price_cents: null,
      total_cents: null,
      position: 2,
    },
  ].map((item) => ({
    ...item,
    quote_id: quote.id,
    user_id: userId,
    price_book_item_id: null,
    photo_citations: ["photo-1-pwtest"],
    confidence: "stated",
  }));
  const { error: itemsError } = await client
    .from("quote_line_items")
    .insert(items);
  if (itemsError) throw new Error(`line items insert: ${itemsError.message}`);
  return { id: quote.id, shareToken: quote.share_token };
}
