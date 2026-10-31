-- Udhaar Voice: access to usage_events (0008). Tables aren't exposed to the Data API by default,
-- so each new table is granted explicitly, as in 0002.
grant select, insert, update, delete on usage_events to authenticated, service_role;
