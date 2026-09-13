-- Every workspace belongs to exactly one Supabase Auth user.
drop index if exists public.pulso_workspaces_owner_id_idx;
drop index if exists public.pulso_workspaces_owner_id_key;

-- Rows without an owner are unreachable through the app and would block the constraint.
delete from public.pulso_workspaces where owner_id is null;

alter table public.pulso_workspaces alter column owner_id set not null;

create unique index pulso_workspaces_owner_id_key
  on public.pulso_workspaces(owner_id);
