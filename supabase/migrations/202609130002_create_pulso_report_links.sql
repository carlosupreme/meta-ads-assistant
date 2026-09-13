-- Public, revocable links to a business report. Only the server (secret key) reads or writes them.
create table if not exists public.pulso_report_links (
  token text primary key,
  workspace_id uuid not null references public.pulso_workspaces(id) on delete cascade,
  organization_id text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz null
);

create index if not exists pulso_report_links_workspace_org_idx
  on public.pulso_report_links(workspace_id, organization_id);

-- RLS with no policies: anon and authenticated users cannot list or guess tokens through the API.
alter table public.pulso_report_links enable row level security;
revoke all on table public.pulso_report_links from anon, authenticated;
