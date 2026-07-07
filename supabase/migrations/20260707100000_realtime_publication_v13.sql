-- SPEC v1.3 (Mobile UI/UX): the review screen's pre-first-item wait renders
-- a stage ticker driven by realtime agent_traces inserts, and quote status
-- changes (sent/accepted) sync across devices via the quotes table.
-- quote_events and quote_line_items are already in the publication from the
-- initial migration; this adds the two tables v1.3 introduces as realtime
-- consumers. RLS still gates what each subscriber can see.

alter publication supabase_realtime add table public.quotes, public.agent_traces;
