-- Udhaar Voice: who can read and write what.
-- Signed-in shopkeepers reach only their own shop's rows. Server jobs (webhooks, the call dispatcher,
-- sign-up) use the service role key, which bypasses these rules and never reaches the browser.

-- The signed-in user's shop. security definer so it can read shops without recursing into its policy.
create function my_shop_id() returns uuid
  language sql
  stable
  security definer
  set search_path = public
as $$
  select id from shops where owner_id = auth.uid()
$$;
revoke execute on function my_shop_id() from public, anon;
grant execute on function my_shop_id() to authenticated;

alter table profiles enable row level security;
create policy own_profile_read on profiles for select to authenticated using (id = auth.uid());
create policy own_profile_update on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

alter table shops enable row level security;
create policy own_shop_read on shops for select to authenticated using (owner_id = auth.uid());
create policy own_shop_update on shops for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Every table keyed by shop_id gets the same rule.
do $$
declare
  t text;
begin
  foreach t in array array[
    'shop_settings', 'customers', 'khata_imports', 'ledger_entries', 'payments', 'reminder_batches',
    'calls', 'call_events', 'promises', 'disputes', 'notes', 'khata_import_changes'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy own_shop on %I for all to authenticated
         using (shop_id = (select my_shop_id()))
         with check (shop_id = (select my_shop_id()))',
      t
    );
  end loop;
end;
$$;

-- Server only: no policies, so only the service role can touch them.
alter table bolna_webhooks enable row level security;
alter table try_calls enable row level security;

-- ---------------------------------------------------------------- files

insert into storage.buckets (id, name, public)
values ('khata-photos', 'khata-photos', false), ('avatars', 'avatars', false)
on conflict (id) do nothing;

-- khata-photos/{shop_id}/{import_id}.jpg
create policy khata_photos_own_shop on storage.objects for all to authenticated
  using (bucket_id = 'khata-photos' and (storage.foldername(name))[1] = (select my_shop_id())::text)
  with check (bucket_id = 'khata-photos' and (storage.foldername(name))[1] = (select my_shop_id())::text);

-- avatars/{user_id}/avatar.jpg
create policy avatars_own on storage.objects for all to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
