-- QuoteLens initial schema
-- Nine tables: profiles, price_books, price_book_items, jobs, captures,
-- quotes, quote_line_items, quote_events, agent_traces.
-- Hard invariant: RLS enabled on every table.

-- ============================================================
-- extensions
-- ============================================================

-- gen_random_bytes (share tokens) lives in pgcrypto; gen_random_uuid is built in.
create extension if not exists pgcrypto with schema extensions;

-- ============================================================
-- enums
-- ============================================================

create type public.unit_type as enum ('sqft', 'linear_ft', 'each', 'flat');

create type public.capture_kind as enum ('photo', 'audio');

create type public.quote_status as enum (
  'generating',
  'completed',
  'failed',
  'sent',
  'accepted'
);

create type public.event_type as enum (
  'line_item_drafted',
  'retry_started',
  'generation_completed',
  'generation_failed',
  'quote_accepted'
);

create type public.confidence_level as enum ('stated', 'inferred');

-- ============================================================
-- trigger function: updated_at maintenance
-- ============================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- tables
-- ============================================================

-- profiles: one row per auth user
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  trade text,
  created_at timestamptz not null default now()
);

-- price_books: user-owned books plus global seed templates (user_id null, is_template true)
create table public.price_books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  name text not null,
  trade text,
  is_template boolean not null default false,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

-- price_book_items: per-unit pricing (sqft, linear_ft, each, flat)
create table public.price_book_items (
  id uuid primary key default gen_random_uuid(),
  price_book_id uuid not null references public.price_books (id) on delete cascade,
  name text not null,
  description text,
  unit public.unit_type not null,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  created_at timestamptz not null default now()
);

-- jobs: a capture session target (client, address, trade)
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_name text,
  address text,
  trade text,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

-- captures: metadata rows for media uploaded direct to Storage by the device
create table public.captures (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind public.capture_kind not null,
  storage_path text not null,
  duration_seconds numeric,
  created_at timestamptz not null default now()
);

-- quotes: pipeline output container; share_token is the unguessable public link
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status public.quote_status not null default 'generating',
  share_token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  retry_count integer not null default 0,
  subtotal_cents integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- quote_line_items: carries user_id so device-direct edits work under RLS.
-- photo_citations non-empty is the mandatory-citation invariant.
-- unit_price_cents null renders as unpriced (no invented prices).
create table public.quote_line_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  description text not null,
  quantity numeric,
  unit public.unit_type,
  unit_price_cents integer check (unit_price_cents is null or unit_price_cents >= 0),
  total_cents integer,
  price_book_item_id uuid references public.price_book_items (id) on delete set null,
  photo_citations text[] not null check (array_length(photo_citations, 1) >= 1),
  confidence public.confidence_level not null default 'stated',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- quote_events: durable pipeline event log; feeds live assembly via realtime
create table public.quote_events (
  id bigint generated always as identity primary key,
  quote_id uuid not null references public.quotes (id) on delete cascade,
  event_type public.event_type not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- agent_traces: one row per pipeline node run, powers the trace screen
create table public.agent_traces (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id) on delete cascade,
  node text not null,
  input jsonb,
  output jsonb,
  duration_ms integer,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now()
);

-- ============================================================
-- updated_at triggers
-- ============================================================

create trigger set_quotes_updated_at
  before update on public.quotes
  for each row execute function public.set_updated_at();

create trigger set_quote_line_items_updated_at
  before update on public.quote_line_items
  for each row execute function public.set_updated_at();

-- ============================================================
-- indexes (FKs used in policies and subqueries)
-- ============================================================

create index idx_price_books_user_id on public.price_books (user_id);
create index idx_price_book_items_price_book_id on public.price_book_items (price_book_id);
create index idx_jobs_user_id on public.jobs (user_id);
create index idx_captures_job_id on public.captures (job_id);
create index idx_captures_user_id on public.captures (user_id);
create index idx_quotes_job_id on public.quotes (job_id);
create index idx_quotes_user_id on public.quotes (user_id);
create index idx_quote_line_items_quote_id on public.quote_line_items (quote_id);
create index idx_quote_line_items_user_id on public.quote_line_items (user_id);
create index idx_quote_line_items_price_book_item_id on public.quote_line_items (price_book_item_id);
create index idx_quote_events_quote_id_id on public.quote_events (quote_id, id);
create index idx_agent_traces_quote_id on public.agent_traces (quote_id);

-- ============================================================
-- row level security: enabled on every table (hard spec invariant)
-- ============================================================

alter table public.profiles enable row level security;
alter table public.price_books enable row level security;
alter table public.price_book_items enable row level security;
alter table public.jobs enable row level security;
alter table public.captures enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_line_items enable row level security;
alter table public.quote_events enable row level security;
alter table public.agent_traces enable row level security;

-- ============================================================
-- policies: profiles (owner via id = auth.uid())
-- ============================================================

create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy "profiles_insert_own" on public.profiles
  for insert to authenticated
  with check (id = (select auth.uid()));

create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "profiles_delete_own" on public.profiles
  for delete to authenticated
  using (id = (select auth.uid()));

-- ============================================================
-- policies: price_books (owner CRUD + read access to global templates)
-- ============================================================

create policy "price_books_select_own_or_template" on public.price_books
  for select to authenticated
  using (user_id = (select auth.uid()) or is_template = true);

create policy "price_books_insert_own" on public.price_books
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "price_books_update_own" on public.price_books
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "price_books_delete_own" on public.price_books
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ============================================================
-- policies: price_book_items (scoped through the parent book)
-- ============================================================

create policy "price_book_items_select_own_or_template" on public.price_book_items
  for select to authenticated
  using (
    exists (
      select 1 from public.price_books pb
      where pb.id = price_book_items.price_book_id
        and (pb.user_id = (select auth.uid()) or pb.is_template = true)
    )
  );

create policy "price_book_items_insert_own" on public.price_book_items
  for insert to authenticated
  with check (
    exists (
      select 1 from public.price_books pb
      where pb.id = price_book_items.price_book_id
        and pb.user_id = (select auth.uid())
    )
  );

create policy "price_book_items_update_own" on public.price_book_items
  for update to authenticated
  using (
    exists (
      select 1 from public.price_books pb
      where pb.id = price_book_items.price_book_id
        and pb.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.price_books pb
      where pb.id = price_book_items.price_book_id
        and pb.user_id = (select auth.uid())
    )
  );

create policy "price_book_items_delete_own" on public.price_book_items
  for delete to authenticated
  using (
    exists (
      select 1 from public.price_books pb
      where pb.id = price_book_items.price_book_id
        and pb.user_id = (select auth.uid())
    )
  );

-- ============================================================
-- policies: jobs (owner CRUD)
-- ============================================================

create policy "jobs_select_own" on public.jobs
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "jobs_insert_own" on public.jobs
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "jobs_update_own" on public.jobs
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "jobs_delete_own" on public.jobs
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ============================================================
-- policies: captures (owner CRUD)
-- ============================================================

create policy "captures_select_own" on public.captures
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "captures_insert_own" on public.captures
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "captures_update_own" on public.captures
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "captures_delete_own" on public.captures
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ============================================================
-- policies: quotes (owner CRUD; public share page reads via
-- service role on the web backend, not through RLS)
-- ============================================================

create policy "quotes_select_own" on public.quotes
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "quotes_insert_own" on public.quotes
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "quotes_update_own" on public.quotes
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "quotes_delete_own" on public.quotes
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ============================================================
-- policies: quote_line_items (owner CRUD via user_id so
-- device-direct edits sync under RLS without FastAPI in the loop)
-- ============================================================

create policy "quote_line_items_select_own" on public.quote_line_items
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "quote_line_items_insert_own" on public.quote_line_items
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "quote_line_items_update_own" on public.quote_line_items
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "quote_line_items_delete_own" on public.quote_line_items
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ============================================================
-- policies: quote_events (select only, scoped through owned quotes;
-- writes come from the backend via service role, which bypasses RLS)
-- ============================================================

create policy "quote_events_select_own_quote" on public.quote_events
  for select to authenticated
  using (
    exists (
      select 1 from public.quotes q
      where q.id = quote_events.quote_id
        and q.user_id = (select auth.uid())
    )
  );

-- ============================================================
-- policies: agent_traces (select only, scoped through owned quotes;
-- writes come from the backend via service role, which bypasses RLS)
-- ============================================================

create policy "agent_traces_select_own_quote" on public.agent_traces
  for select to authenticated
  using (
    exists (
      select 1 from public.quotes q
      where q.id = agent_traces.quote_id
        and q.user_id = (select auth.uid())
    )
  );

-- ============================================================
-- realtime: postgres_changes on quote_events (live assembly)
-- and quote_line_items (cross-device edit sync)
-- ============================================================

alter publication supabase_realtime add table public.quote_events, public.quote_line_items;

-- ============================================================
-- storage: private captures bucket, paths scoped {user_id}/{job_id}/...
-- ============================================================

insert into storage.buckets (id, name, public)
values ('captures', 'captures', false)
on conflict (id) do nothing;

create policy "captures_objects_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'captures'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "captures_objects_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'captures'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "captures_objects_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'captures'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'captures'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "captures_objects_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'captures'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
