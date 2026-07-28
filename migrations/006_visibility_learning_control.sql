-- Bruno's queryable read model, message audit ledger, learned-memory layer,
-- and owner action audit. Instantly remains the transactional source of truth.

CREATE TABLE IF NOT EXISTS crm_leads (
  provider_lead_id text PRIMARY KEY,
  email text NOT NULL,
  campaign_id text,
  list_id text,
  first_name text,
  last_name text,
  company_name text,
  company_domain text,
  job_title text,
  status integer,
  interest_status integer,
  verification_status integer,
  email_open_count integer NOT NULL DEFAULT 0,
  email_click_count integer NOT NULL DEFAULT 0,
  email_reply_count integer NOT NULL DEFAULT 0,
  last_contact_at timestamptz,
  last_open_at timestamptz,
  last_click_at timestamptz,
  last_reply_at timestamptz,
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_created_at timestamptz,
  provider_updated_at timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_leads_email_idx ON crm_leads (lower(email));
CREATE INDEX IF NOT EXISTS crm_leads_campaign_status_idx ON crm_leads (campaign_id, status);
CREATE INDEX IF NOT EXISTS crm_leads_interest_idx ON crm_leads (interest_status);
CREATE INDEX IF NOT EXISTS crm_leads_company_idx ON crm_leads (lower(company_name));
CREATE INDEX IF NOT EXISTS crm_leads_synced_idx ON crm_leads (synced_at DESC);

CREATE TABLE IF NOT EXISTS crm_messages (
  provider_email_id text PRIMARY KEY,
  message_id text,
  thread_id text,
  provider_lead_id text,
  lead_email text,
  campaign_id text,
  list_id text,
  eaccount text,
  direction text NOT NULL CHECK (direction IN ('sent', 'received', 'manual')),
  step text,
  variant text,
  subject text,
  body_text text,
  body_html text,
  content_preview text,
  is_unread boolean,
  is_auto_reply boolean,
  is_focused boolean,
  email_status integer,
  provider_created_at timestamptz,
  timestamp_email timestamptz,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_messages_lead_time_idx ON crm_messages (lower(lead_email), timestamp_email DESC);
CREATE INDEX IF NOT EXISTS crm_messages_campaign_time_idx ON crm_messages (campaign_id, timestamp_email DESC);
CREATE INDEX IF NOT EXISTS crm_messages_account_time_idx ON crm_messages (eaccount, timestamp_email DESC);
CREATE INDEX IF NOT EXISTS crm_messages_direction_time_idx ON crm_messages (direction, timestamp_email DESC);
CREATE INDEX IF NOT EXISTS crm_messages_thread_idx ON crm_messages (thread_id);

CREATE TABLE IF NOT EXISTS campaign_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id text NOT NULL,
  campaign_name text,
  content_hash text NOT NULL,
  snapshot jsonb NOT NULL,
  reason text NOT NULL DEFAULT 'sync',
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, content_hash)
);

CREATE INDEX IF NOT EXISTS campaign_snapshots_campaign_time_idx
  ON campaign_snapshots (campaign_id, captured_at DESC);

CREATE TABLE IF NOT EXISTS sync_checkpoints (
  stream text PRIMARY KEY,
  cursor text,
  watermark timestamptz,
  status text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'ok', 'error')),
  records_synced integer NOT NULL DEFAULT 0,
  last_started_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  provider_leads integer,
  local_leads integer,
  provider_sent integer,
  local_sent integer,
  matches boolean NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  reconciled_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reconciliation_scope_time_idx
  ON reconciliation_runs (scope, reconciled_at DESC);

CREATE TABLE IF NOT EXISTS agent_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('preference', 'copy', 'objection', 'targeting', 'process')),
  lesson text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence numeric NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'active', 'rejected', 'retired')),
  source_approval_ids uuid[] NOT NULL DEFAULT '{}',
  proposed_by text NOT NULL DEFAULT 'bruno',
  approved_by text,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_lessons_status_kind_idx
  ON agent_lessons (status, kind, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_action_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  actor text NOT NULL DEFAULT 'dashboard',
  reason text,
  before_state jsonb,
  after_state jsonb,
  provider_response jsonb,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('proposed', 'completed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_action_logs_time_idx
  ON agent_action_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS agent_action_logs_target_idx
  ON agent_action_logs (target_type, target_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reply_work_states (
  reply_classification_id uuid PRIMARY KEY REFERENCES reply_classifications(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'handled', 'snoozed')),
  snoozed_until timestamptz,
  actor text,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

