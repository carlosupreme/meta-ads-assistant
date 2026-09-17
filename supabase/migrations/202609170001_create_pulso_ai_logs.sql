-- One row per OpenAI call: who and where it came from, tokens, estimated cost, and the full request and response in `entry`.
-- Only the server (secret key) writes it; the backoffice reads it with the same key.
create table if not exists public.pulso_ai_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  workspace_id uuid null references public.pulso_workspaces(id) on delete set null,
  owner_email text null,
  organization_id text null,
  organization_name text null,
  feature text not null,
  route text null,
  view text null,
  trigger text not null default 'user' check (trigger in ('user', 'cron')),
  model text not null,
  status text not null check (status in ('ok', 'error')),
  duration_ms integer not null default 0,
  input_tokens integer not null default 0,
  cached_input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  reasoning_tokens integer not null default 0,
  total_tokens integer not null default 0,
  cost_usd numeric(14, 8) not null default 0,
  openai_response_id text null,
  error text null,
  entry jsonb not null default '{}'::jsonb
);

create index if not exists pulso_ai_logs_created_at_idx on public.pulso_ai_logs(created_at desc);
create index if not exists pulso_ai_logs_workspace_created_at_idx on public.pulso_ai_logs(workspace_id, created_at desc);
create index if not exists pulso_ai_logs_feature_created_at_idx on public.pulso_ai_logs(feature, created_at desc);

-- RLS with no policies: app users cannot read other clients' prompts or usage through the API.
alter table public.pulso_ai_logs enable row level security;
revoke all on table public.pulso_ai_logs from anon, authenticated;

-- Daily totals per client, business, feature and view, by Mexico City day, for the backoffice.
create or replace view public.pulso_ai_usage_daily
with (security_invoker = true)
as
select
  (created_at at time zone 'America/Mexico_City')::date as day,
  workspace_id,
  owner_email,
  organization_id,
  organization_name,
  feature,
  view,
  trigger,
  model,
  count(*)::integer as calls,
  (count(*) filter (where status = 'error'))::integer as errors,
  sum(input_tokens)::bigint as input_tokens,
  sum(cached_input_tokens)::bigint as cached_input_tokens,
  sum(output_tokens)::bigint as output_tokens,
  sum(reasoning_tokens)::bigint as reasoning_tokens,
  sum(total_tokens)::bigint as total_tokens,
  sum(cost_usd) as cost_usd,
  sum(duration_ms)::bigint as duration_ms,
  max(created_at) as last_call_at
from public.pulso_ai_logs
group by 1, 2, 3, 4, 5, 6, 7, 8, 9;

revoke all on table public.pulso_ai_usage_daily from anon, authenticated;
