-- At most one agreement record per quote. Accept must be idempotent
-- end-to-end (SPEC - Data flow: "Accept writes a quote_events row");
-- without this, concurrent accepts could insert duplicate quote_accepted
-- events, each re-firing the mobile Accepted banner over realtime.
create unique index if not exists quote_events_one_accept_per_quote
  on public.quote_events (quote_id)
  where event_type = 'quote_accepted';
