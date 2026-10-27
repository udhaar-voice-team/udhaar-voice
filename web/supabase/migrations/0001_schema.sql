-- Udhaar Voice: tables, types and indexes.
-- Every row a shop owns carries shop_id, so one access rule (0002_security.sql) covers every table.
-- Totals (balances, collections, call stats) are computed from these rows, never stored.

create type language_code as enum ('bn', 'hi', 'en');
create type entry_source as enum ('photo', 'manual', 'voice');
create type payment_method as enum ('cash', 'upi');
create type dispute_kind as enum ('already_paid', 'wrong_amount', 'other');
create type note_kind as enum ('request', 'complaint', 'life_event', 'product_demand', 'relationship', 'other');
create type call_kind as enum ('reminder', 'report');
-- Bolna's execution statuses, plus "scheduled" for calls not yet handed to Bolna.
create type call_status as enum (
  'scheduled', 'queued', 'ringing', 'in_progress', 'completed',
  'no_answer', 'busy', 'failed', 'rescheduled', 'cancelled'
);
create type call_outcome as enum (
  'promised', 'disputed', 'callback', 'refused', 'wrong_number', 'opted_out', 'no_answer', 'report_delivered'
);

create function set_updated_at() returns trigger
  language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- account and shop

-- The person who signs in. Email and password live in auth.users.
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  phone text not null unique check (phone ~ '^\+91[6-9][0-9]{9}$'),
  app_language language_code not null default 'en',
  avatar_path text,
  created_at timestamptz not null default now()
);

create table shops (
  id uuid primary key default gen_random_uuid(),
  -- One shop per account for now; dropping UNIQUE allows several later.
  owner_id uuid not null unique references profiles (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  upi_id text check (upi_id is null or upi_id ~ '^[A-Za-z0-9._-]{2,}@[A-Za-z0-9.-]{2,}$'),
  created_at timestamptz not null default now()
);

create table shop_settings (
  shop_id uuid primary key references shops (id) on delete cascade,
  calling_start smallint not null default 8 check (calling_start between 0 and 23),
  calling_end smallint not null default 19 check (calling_end between 1 and 24),
  reminder_gap_days smallint not null default 3 check (reminder_gap_days between 1 and 14),
  max_call_minutes smallint not null default 3 check (max_call_minutes between 1 and 10),
  default_customer_language language_code not null default 'bn',
  report_enabled boolean not null default true,
  report_time time not null default '20:00',
  report_language language_code not null default 'bn',
  -- Sends Bolna's bypass_call_guardrails, for live demos outside calling hours.
  demo_bypass_hours boolean not null default false,
  updated_at timestamptz not null default now(),
  check (calling_end > calling_start)
);
create trigger shop_settings_updated_at before update on shop_settings
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------- the khata

-- A person who buys on credit from one shop. The same phone at two shops is two rows.
create table customers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  -- As written in the khata, in Bengali or Devanagari script.
  name_native text,
  -- E.164. Null until the shopkeeper adds it (khata photos rarely have numbers).
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  language language_code not null,
  opted_out_at timestamptz,
  -- Another customer of the same shop who pays for this one.
  pays_through_id uuid,
  created_at timestamptz not null default now(),
  unique (shop_id, id),
  unique (shop_id, phone),
  check (pays_through_id is distinct from id),
  foreign key (shop_id, pays_through_id) references customers (shop_id, id) on delete set null (pays_through_id)
);

-- One saved khata photo.
create table khata_imports (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id) on delete cascade,
  source text not null check (source in ('upload', 'sample')),
  -- Path in the private khata-photos bucket: {shop_id}/{import_id}.jpg
  photo_path text,
  -- The vision model that read the page, and its raw rows with per-field confidence.
  model text,
  extraction jsonb,
  undone_at timestamptz,
  created_at timestamptz not null default now()
);
create index khata_imports_shop on khata_imports (shop_id, created_at desc);

-- One line in the khata: goods given on credit.
create table ledger_entries (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id) on delete cascade,
  customer_id uuid not null,
  amount integer not null check (amount > 0),
  items text not null default '',
  -- The date on the khata page, which may be weeks before it was typed in.
  entry_date date not null,
  source entry_source not null,
  import_id uuid references khata_imports (id) on delete set null,
  -- Set when the import that added it is undone. Kept for history, left out of balances.
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (shop_id, customer_id) references customers (shop_id, id) on delete cascade
);
create index ledger_entries_customer on ledger_entries (customer_id, entry_date);
create index ledger_entries_import on ledger_entries (import_id) where import_id is not null;

create table payments (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id) on delete cascade,
  customer_id uuid not null,
  amount integer not null check (amount > 0),
  method payment_method not null,
  paid_on date not null,
  created_at timestamptz not null default now(),
  foreign key (shop_id, customer_id) references customers (shop_id, id) on delete cascade
);
create index payments_customer on payments (customer_id, paid_on);
create index payments_shop_day on payments (shop_id, paid_on);

-- ---------------------------------------------------------------- calls

-- Reminder calls scheduled together. Status comes from its calls, so it is not stored.
create table reminder_batches (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id) on delete cascade,
  scheduled_at timestamptz not null,
  -- Null means each customer is called in their own language.
  language language_code,
  created_at timestamptz not null default now()
);
create index reminder_batches_shop on reminder_batches (shop_id, created_at desc);

create table calls (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id) on delete cascade,
  kind call_kind not null,
  -- Report calls go to the shopkeeper, so they have no customer.
  customer_id uuid,
  batch_id uuid references reminder_batches (id) on delete set null,
  -- The number actually dialled. Tells us whether a wrong number was later fixed.
  to_number text,
  language language_code not null,
  status call_status not null default 'scheduled',
  outcome call_outcome,
  scheduled_at timestamptz not null,
  dispatched_at timestamptz,
  started_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  duration_sec integer check (duration_sec >= 0),
  cost_usd numeric(10, 4) check (cost_usd >= 0),
  bolna_execution_id text unique,
  bolna_agent_id text,
  recording_url text,
  -- [{speaker, text, gloss, at}], the app's Turn shape.
  transcript jsonb not null default '[]',
  -- The structured result of the call, the app's Extraction shape.
  extraction jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'report') = (customer_id is null)),
  foreign key (shop_id, customer_id) references customers (shop_id, id) on delete cascade
);
create index calls_waiting on calls (status, scheduled_at) where status in ('scheduled', 'queued');
create index calls_on_line on calls (status) where status in ('ringing', 'in_progress');
create index calls_shop on calls (shop_id, scheduled_at desc);
create index calls_customer on calls (customer_id, scheduled_at desc) where customer_id is not null;
create index calls_batch on calls (batch_id) where batch_id is not null;
create trigger calls_updated_at before update on calls
  for each row execute function set_updated_at();

-- The status timeline shown on a call's page.
create table call_events (
  id bigint generated always as identity primary key,
  call_id uuid not null references calls (id) on delete cascade,
  shop_id uuid not null references shops (id) on delete cascade,
  status call_status not null,
  detail text,
  at timestamptz not null default now()
);
create index call_events_call on call_events (call_id, at);

-- ---------------------------------------------------------------- what calls learn

-- "I'll pay ₹500 on Friday". Kept when kept_at is set; broken once due_date passes without it.
create table promises (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id) on delete cascade,
  customer_id uuid not null,
  call_id uuid references calls (id) on delete set null,
  amount integer not null check (amount > 0),
  due_date date not null,
  kept_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (shop_id, customer_id) references customers (shop_id, id) on delete cascade
);
create index promises_customer on promises (customer_id, due_date);
create index promises_open on promises (shop_id, due_date) where kept_at is null;

create table disputes (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id) on delete cascade,
  customer_id uuid not null,
  call_id uuid references calls (id) on delete set null,
  kind dispute_kind not null,
  reason text not null,
  -- The amount the customer says is right.
  amount integer check (amount >= 0),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (shop_id, customer_id) references customers (shop_id, id) on delete cascade
);
create index disputes_customer on disputes (customer_id);

-- Short facts pulled from calls. They feed the knowledge graph and the agent's memory.
create table notes (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id) on delete cascade,
  customer_id uuid not null,
  call_id uuid references calls (id) on delete set null,
  kind note_kind not null,
  text text not null,
  -- For product_demand notes, e.g. "Maggi".
  product text,
  created_at timestamptz not null default now(),
  foreign key (shop_id, customer_id) references customers (shop_id, id) on delete cascade
);
create index notes_customer on notes (customer_id);
create index notes_product on notes (shop_id, product) where product is not null;

-- Exactly what one khata import did, so it can be undone precisely.
create table khata_import_changes (
  id bigint generated always as identity primary key,
  import_id uuid not null references khata_imports (id) on delete cascade,
  shop_id uuid not null references shops (id) on delete cascade,
  kind text not null check (kind in ('entry_added', 'entry_updated', 'customer_added')),
  entry_id uuid references ledger_entries (id) on delete cascade,
  customer_id uuid references customers (id) on delete cascade,
  -- For entry_updated: the values before the import, restored on undo.
  previous_amount integer,
  previous_items text,
  check ((kind = 'customer_added') = (customer_id is not null and entry_id is null))
);
create index khata_import_changes_import on khata_import_changes (import_id);

-- ---------------------------------------------------------------- server only

-- Every webhook Bolna sends, stored raw before processing. A resent webhook is ignored by its hash.
create table bolna_webhooks (
  id bigint generated always as identity primary key,
  execution_id text,
  payload_hash text not null unique,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);
create index bolna_webhooks_execution on bolna_webhooks (execution_id);
create index bolna_webhooks_pending on bolna_webhooks (received_at) where processed_at is null;

-- Demo calls from the public /try page, to cap them per number and per day.
create table try_calls (
  id bigint generated always as identity primary key,
  phone text not null,
  called_on date not null,
  created_at timestamptz not null default now(),
  unique (phone, called_on)
);
create index try_calls_day on try_calls (called_on);
