// Removes the quotes this run created (events, line items, then quotes).
// The shared job row is kept for reuse across runs.

import { serviceClient } from "./support";

export default async function globalTeardown() {
  const ids = [process.env.PW_RENDER_ID, process.env.PW_ACCEPT_ID].filter(
    (id): id is string => Boolean(id),
  );
  if (ids.length === 0) return;
  const client = serviceClient();
  await client.from("quote_events").delete().in("quote_id", ids);
  await client.from("quote_line_items").delete().in("quote_id", ids);
  await client.from("quotes").delete().in("id", ids);
}
