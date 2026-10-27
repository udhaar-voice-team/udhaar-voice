-- Udhaar Voice: writes that touch several rows and must happen all together or not at all.
-- They run as the signed-in user (security invoker), so the access rules in 0002_security.sql apply.

create function require_shop() returns uuid
  language plpgsql
  stable
  set search_path = public
as $$
declare
  v_shop uuid := my_shop_id();
begin
  if v_shop is null then
    raise exception 'Sign in again to continue.' using errcode = '28000';
  end if;
  return v_shop;
end;
$$;

-- Records a payment and marks the promises it covers as kept, earliest due first. An overdue promise
-- still counts (paid late), but one already replaced by a newer promise stays broken.
create function record_payment(p_customer_id uuid, p_amount integer, p_method payment_method, p_paid_on date)
  returns uuid
  language plpgsql
  set search_path = public
as $$
declare
  v_shop uuid := require_shop();
  v_id uuid;
  v_remaining integer := p_amount;
  v_balance integer;
  v_open uuid[];
  p record;
begin
  if not exists (select 1 from customers where id = p_customer_id and shop_id = v_shop) then
    raise exception 'Customer not found';
  end if;

  insert into payments (shop_id, customer_id, amount, method, paid_on)
  values (v_shop, p_customer_id, p_amount, p_method, p_paid_on)
  returning id into v_id;

  select coalesce(array_agg(o.id), '{}') into v_open from promises o
  where o.customer_id = p_customer_id and o.kept_at is null
    and not (
      o.due_date < p_paid_on
      and exists (select 1 from promises n where n.customer_id = o.customer_id and n.created_at > o.created_at)
    );

  for p in select id, amount from promises where id = any(v_open) order by due_date, created_at loop
    exit when v_remaining < p.amount;
    update promises set kept_at = now() where id = p.id;
    v_remaining := v_remaining - p.amount;
  end loop;

  -- Nothing owed any more: every open promise is kept.
  select coalesce((select sum(amount) from ledger_entries where customer_id = p_customer_id and voided_at is null), 0)
       - coalesce((select sum(amount) from payments where customer_id = p_customer_id), 0)
    into v_balance;
  if v_balance <= 0 then
    update promises set kept_at = now() where id = any(v_open) and kept_at is null;
  end if;

  return v_id;
end;
$$;

-- Saves the confirmed rows of one khata photo and records what it did, so it can be undone.
-- p_rows: [{action: add|update|skip, saved_entry_id, customer_id, name, name_native, phone, language,
--           amount, items, entry_date}]. A row without customer_id creates a customer.
create function save_khata_import(
  p_source text,
  p_rows jsonb,
  p_photo_path text default null,
  p_model text default null,
  p_extraction jsonb default null
)
  returns jsonb
  language plpgsql
  set search_path = public
as $$
declare
  v_shop uuid := require_shop();
  v_import uuid;
  v_customer uuid;
  v_entry uuid;
  v_prev record;
  v_added integer := 0;
  v_updated integer := 0;
  v_new integer := 0;
  r record;
begin
  insert into khata_imports (shop_id, source, photo_path, model, extraction)
  values (v_shop, p_source, p_photo_path, p_model, p_extraction)
  returning id into v_import;

  for r in
    select * from jsonb_to_recordset(p_rows) as x(
      action text, saved_entry_id uuid, customer_id uuid, name text, name_native text, phone text,
      language language_code, amount integer, items text, entry_date date
    )
  loop
    continue when r.action = 'skip';

    if r.action = 'update' then
      select amount, items into v_prev from ledger_entries
      where id = r.saved_entry_id and shop_id = v_shop and voided_at is null
      for update;
      if found then
        insert into khata_import_changes (import_id, shop_id, kind, entry_id, previous_amount, previous_items)
        values (v_import, v_shop, 'entry_updated', r.saved_entry_id, v_prev.amount, v_prev.items);
        update ledger_entries set amount = r.amount, items = coalesce(r.items, '') where id = r.saved_entry_id;
        v_updated := v_updated + 1;
        continue;
      end if;
      -- The saved entry is gone: add the row as a new entry instead.
    end if;

    v_customer := r.customer_id;
    if v_customer is null then
      insert into customers (shop_id, name, name_native, phone, language)
      values (v_shop, r.name, nullif(r.name_native, ''), nullif(r.phone, ''), coalesce(r.language, 'bn'))
      returning id into v_customer;
      insert into khata_import_changes (import_id, shop_id, kind, customer_id)
      values (v_import, v_shop, 'customer_added', v_customer);
      v_new := v_new + 1;
    end if;

    insert into ledger_entries (shop_id, customer_id, amount, items, entry_date, source, import_id)
    values (v_shop, v_customer, r.amount, coalesce(r.items, ''), r.entry_date, 'photo', v_import)
    returning id into v_entry;
    insert into khata_import_changes (import_id, shop_id, kind, entry_id)
    values (v_import, v_shop, 'entry_added', v_entry);
    v_added := v_added + 1;
  end loop;

  return jsonb_build_object('import_id', v_import, 'added', v_added, 'updated', v_updated, 'new_customers', v_new);
end;
$$;

-- Undoes a khata import: voids what it added, restores what it changed, and removes the customers
-- it created unless they have other records by now.
create function undo_khata_import(p_import_id uuid)
  returns jsonb
  language plpgsql
  set search_path = public
as $$
declare
  v_shop uuid := require_shop();
  v_undone timestamptz;
  v_removed integer;
  v_restored integer := 0;
  v_customers integer;
  c record;
begin
  select undone_at into v_undone from khata_imports where id = p_import_id and shop_id = v_shop for update;
  if not found or v_undone is not null then
    raise exception 'This import was already undone.';
  end if;

  update ledger_entries set voided_at = now() where import_id = p_import_id and voided_at is null;
  get diagnostics v_removed = row_count;

  for c in
    select entry_id, previous_amount, previous_items from khata_import_changes
    where import_id = p_import_id and kind = 'entry_updated'
  loop
    update ledger_entries set amount = c.previous_amount, items = c.previous_items
    where id = c.entry_id and voided_at is null;
    if found then
      v_restored := v_restored + 1;
    end if;
  end loop;

  delete from customers cu
  using khata_import_changes ch
  where ch.import_id = p_import_id and ch.kind = 'customer_added' and cu.id = ch.customer_id
    and not exists (
      select 1 from ledger_entries e
      where e.customer_id = cu.id and (e.voided_at is null or e.import_id is distinct from p_import_id)
    )
    and not exists (select 1 from payments x where x.customer_id = cu.id)
    and not exists (select 1 from promises x where x.customer_id = cu.id)
    and not exists (select 1 from disputes x where x.customer_id = cu.id)
    and not exists (select 1 from notes x where x.customer_id = cu.id)
    and not exists (select 1 from calls x where x.customer_id = cu.id);
  get diagnostics v_customers = row_count;

  update khata_imports set undone_at = now() where id = p_import_id;

  return jsonb_build_object('removed', v_removed, 'restored', v_restored, 'customers_removed', v_customers);
end;
$$;

-- Creates a reminder batch and its calls in one go.
-- p_calls: [{customer_id, to_number, language}]. p_detail goes on each call's first timeline event.
create function create_reminder_batch(
  p_scheduled_at timestamptz,
  p_language language_code,
  p_calls jsonb,
  p_detail text default null
)
  returns uuid
  language plpgsql
  set search_path = public
as $$
declare
  v_shop uuid := require_shop();
  v_batch uuid;
begin
  insert into reminder_batches (shop_id, scheduled_at, language)
  values (v_shop, p_scheduled_at, p_language)
  returning id into v_batch;

  with inserted as (
    insert into calls (shop_id, kind, customer_id, batch_id, to_number, language, status, scheduled_at)
    select v_shop, 'reminder', x.customer_id, v_batch, x.to_number, x.language, 'scheduled', p_scheduled_at
    from jsonb_to_recordset(p_calls) as x(customer_id uuid, to_number text, language language_code)
    returning id
  )
  insert into call_events (call_id, shop_id, status, detail)
  select id, v_shop, 'scheduled', p_detail from inserted;

  return v_batch;
end;
$$;

revoke execute on function require_shop(), record_payment(uuid, integer, payment_method, date),
  save_khata_import(text, jsonb, text, text, jsonb), undo_khata_import(uuid),
  create_reminder_batch(timestamptz, language_code, jsonb, text)
  from public, anon;
grant execute on function require_shop(), record_payment(uuid, integer, payment_method, date),
  save_khata_import(text, jsonb, text, text, jsonb), undo_khata_import(uuid),
  create_reminder_batch(timestamptz, language_code, jsonb, text)
  to authenticated, service_role;
