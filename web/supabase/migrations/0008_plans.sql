-- Udhaar Voice: plans. The khata is free; Asha's calls come with the Asha and Asha Plus plans, and
-- call packs add calls on any plan. Photo reads and WhatsApp reminders are counted, for the free
-- plan's daily photo limit and for "WhatsApp first, then a call".

create type plan_id as enum ('free', 'asha', 'asha_plus');

alter table shops add column if not exists plan plan_id not null default 'free';
alter table shops add column if not exists extra_calls integer not null default 0 check (extra_calls >= 0);

-- Shops that existed before plans keep calling as they did.
update shops set plan = 'asha';

create table if not exists usage_events (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops (id) on delete cascade,
  kind text not null check (kind in ('photo_read', 'whatsapp_reminder')),
  -- The customer a WhatsApp reminder went to.
  customer_id uuid,
  at timestamptz not null default now(),
  foreign key (shop_id, customer_id) references customers (shop_id, id) on delete cascade
);
create index if not exists usage_events_shop_kind_at on usage_events (shop_id, kind, at desc);

alter table usage_events enable row level security;
create policy own_shop on usage_events for all to authenticated
  using (shop_id = (select my_shop_id()))
  with check (shop_id = (select my_shop_id()));

-- Uses call-pack calls: takes `p_count` off the shop's extra calls, never below zero.
create or replace function use_extra_calls(p_count integer) returns void
  language sql
  security invoker
  set search_path = ''
as $$
  update public.shops set extra_calls = greatest(0, extra_calls - greatest(0, p_count))
  where id = (select public.my_shop_id())
$$;
revoke execute on function use_extra_calls(integer) from public, anon;
grant execute on function use_extra_calls(integer) to authenticated;
