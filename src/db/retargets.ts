import { pool } from "./pool.js";

export interface ScheduledRetarget {
  replyClassificationId?: string;
  email: string;
  campaignId?: string;
  providerLeadId?: string;
  companyName?: string;
  returnDate: string;
  originalThread?: string;
  alternateContact?: string;
}

/**
 * Local hour of day to re-approach on the return date. Their first morning back
 * is already crowded, so the retarget lands mid-morning rather than at 00:00.
 */
const RETARGET_HOUR_UTC = 14;

export function retargetRunAfter(returnDate: string) {
  return new Date(`${returnDate}T${String(RETARGET_HOUR_UTC).padStart(2, "0")}:00:00.000Z`);
}

/**
 * Schedule (or move) the single pending retarget for this lead. A later return
 * date always wins: a prospect whose autoresponder first said "back Monday" and
 * then "back the following week" should be reached on the later date.
 */
export async function scheduleRetarget(input: ScheduledRetarget) {
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO scheduled_retargets (
        reply_classification_id, email, campaign_id, provider_lead_id,
        company_name, return_date, run_after, original_thread, alternate_contact
      )
      VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9)
      ON CONFLICT (lower(email), coalesce(campaign_id, '')) WHERE status = 'scheduled'
      DO UPDATE SET
        return_date = GREATEST(scheduled_retargets.return_date, EXCLUDED.return_date),
        run_after = GREATEST(scheduled_retargets.run_after, EXCLUDED.run_after),
        reply_classification_id = EXCLUDED.reply_classification_id,
        original_thread = EXCLUDED.original_thread,
        alternate_contact = EXCLUDED.alternate_contact,
        updated_at = now()
      RETURNING id
    `,
    [
      input.replyClassificationId,
      input.email,
      input.campaignId,
      input.providerLeadId,
      input.companyName,
      input.returnDate,
      retargetRunAfter(input.returnDate),
      input.originalThread,
      input.alternateContact
    ]
  );
  return result.rows[0]?.id;
}

interface RetargetRow {
  id: string;
  email: string;
  campaign_id: string | null;
  provider_lead_id: string | null;
  company_name: string | null;
  return_date: Date;
  original_thread: string | null;
  alternate_contact: string | null;
}

/** Retargets whose return date has arrived and that still need a draft. */
export async function claimDueRetargets(limit = 25) {
  const result = await pool.query<RetargetRow>(
    `
      SELECT id, email, campaign_id, provider_lead_id, company_name,
             return_date, original_thread, alternate_contact
      FROM scheduled_retargets
      WHERE status = 'scheduled' AND run_after <= now()
      ORDER BY run_after
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    `,
    [limit]
  );
  return result.rows;
}

export async function cancelRetargetById(id: string, reason: string) {
  await pool.query(
    "UPDATE scheduled_retargets SET status = 'cancelled', cancelled_reason = $2, updated_at = now() WHERE id = $1",
    [id, reason]
  );
}

export async function markRetargetDrafted(id: string, draftId: string) {
  await pool.query(
    "UPDATE scheduled_retargets SET status = 'drafted', draft_id = $2, updated_at = now() WHERE id = $1",
    [id, draftId]
  );
}

/**
 * Drop a pending retarget. Called when the prospect comes back to us on their
 * own, or opts out, before their return date arrives — re-approaching then would
 * either duplicate a live thread or contact someone who asked us to stop.
 */
export async function cancelPendingRetargets(input: {
  email: string;
  campaignId?: string;
  reason: string;
}) {
  const result = await pool.query<{ id: string }>(
    `
      UPDATE scheduled_retargets
      SET status = 'cancelled', cancelled_reason = $3, updated_at = now()
      WHERE status = 'scheduled'
        AND lower(email) = lower($1)
        AND ($2::text IS NULL OR campaign_id = $2 OR campaign_id IS NULL)
      RETURNING id
    `,
    [input.email, input.campaignId ?? null, input.reason]
  );
  return result.rowCount ?? 0;
}
