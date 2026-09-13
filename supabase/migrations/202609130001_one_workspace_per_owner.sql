-- Each Supabase Auth user owns exactly one workspace. Unowned rows from
-- single-tenant installs remain valid until their owner claims them.
drop index if exists public.pulso_workspaces_owner_id_idx;

create unique index if not exists pulso_workspaces_owner_id_key
  on public.pulso_workspaces(owner_id)
  where owner_id is not null;
