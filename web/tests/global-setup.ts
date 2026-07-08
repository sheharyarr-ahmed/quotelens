// Seeds two fresh quotes per run against the live project: one stays 'sent'
// for the render test, one gets accepted. Tokens/ids ride process.env into
// the worker processes; global-teardown removes everything it created.

import { ensureUser, JOB_MARKER, seedQuote, serviceClient } from "./support";

export default async function globalSetup() {
  const client = serviceClient();
  const userId = await ensureUser(client);

  const { data: existingJob, error: jobLookupError } = await client
    .from("jobs")
    .select("id")
    .eq("user_id", userId)
    .eq("client_name", JOB_MARKER)
    .limit(1)
    .maybeSingle();
  if (jobLookupError) throw new Error(`job lookup: ${jobLookupError.message}`);
  let jobId = existingJob?.id as string | undefined;
  if (!jobId) {
    const { data: job, error } = await client
      .from("jobs")
      .insert({
        user_id: userId,
        client_name: JOB_MARKER,
        address: "12 Demo Street",
        trade: "painting",
        status: "open",
      })
      .select("id")
      .single();
    if (error || !job) throw new Error(`job insert: ${error?.message}`);
    jobId = job.id;
  }

  const renderQuote = await seedQuote(client, userId, jobId!);
  const acceptQuote = await seedQuote(client, userId, jobId!);

  process.env.PW_RENDER_TOKEN = renderQuote.shareToken;
  process.env.PW_RENDER_ID = renderQuote.id;
  process.env.PW_ACCEPT_TOKEN = acceptQuote.shareToken;
  process.env.PW_ACCEPT_ID = acceptQuote.id;
}
