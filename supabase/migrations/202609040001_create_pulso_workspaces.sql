create extension if not exists pgcrypto;

create table if not exists public.pulso_workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid null references auth.users(id) on delete cascade,
  name text not null default 'Mi espacio',
  payload jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pulso_workspaces_owner_id_idx
  on public.pulso_workspaces(owner_id);

alter table public.pulso_workspaces enable row level security;

revoke all on table public.pulso_workspaces from anon;
grant select, insert, update, delete on table public.pulso_workspaces to authenticated;

drop policy if exists "Owners can read their Pulso workspace" on public.pulso_workspaces;
create policy "Owners can read their Pulso workspace"
  on public.pulso_workspaces
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "Owners can create their Pulso workspace" on public.pulso_workspaces;
create policy "Owners can create their Pulso workspace"
  on public.pulso_workspaces
  for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Owners can update their Pulso workspace" on public.pulso_workspaces;
create policy "Owners can update their Pulso workspace"
  on public.pulso_workspaces
  for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "Owners can delete their Pulso workspace" on public.pulso_workspaces;
create policy "Owners can delete their Pulso workspace"
  on public.pulso_workspaces
  for delete
  to authenticated
  using ((select auth.uid()) = owner_id);

create or replace function public.set_pulso_workspace_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists pulso_workspaces_set_updated_at on public.pulso_workspaces;
create trigger pulso_workspaces_set_updated_at
  before update on public.pulso_workspaces
  for each row execute function public.set_pulso_workspace_updated_at();
