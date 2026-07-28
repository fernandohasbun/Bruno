-- Out-of-office handling: label autoresponders as their own intent, and when one
-- carries a return date, hold the lead and re-approach on the day they are back.

ALTER TABLE reply_classifications ADD COLUMN IF NOT EXISTS ooo_return_date date;
ALTER TABLE reply_classifications ADD COLUMN IF NOT EXISTS ooo_alternate_contact text;
ALTER TABLE reply_classifications ADD COLUMN IF NOT EXISTS ooo_date_confidence numeric;

-- One pending retarget per lead per campaign. A prospect who autoresponds to
-- several steps of the same sequence should be re-approached once, on the latest
-- known return date, not once per bounce-back.
CREATE TABLE IF NOT EXISTS scheduled_retargets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reply_classification_id uuid REFERENCES reply_classifications(id),
  email text NOT NULL,
  campaign_id text,
  provider_lead_id text,
  company_name text,
  return_date date NOT NULL,
  run_after timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'drafted', 'cancelled')),
  original_thread text,
  alternate_contact text,
  draft_id uuid REFERENCES drafts(id),
  cancelled_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS scheduled_retargets_pending_idx
  ON scheduled_retargets (lower(email), coalesce(campaign_id, ''))
  WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS scheduled_retargets_due_idx
  ON scheduled_retargets (status, run_after);
