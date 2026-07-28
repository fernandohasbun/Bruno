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
  original_event_id: string | null;
}

/**
 * Retargets whose return date has arrived and that still need a draft.
 *
 * original_event_id carries the event behind the autoresponder we are answering.
 * The dashboard resolves a draft's Instantly message reference through
 * reply_classifications.event_id, so a retarget drafted without it lands in the
 * approval queue un-sendable — reusing the original event threads the
 * re-approach onto the same conversation and keeps Approve working.
 */
export async function claimDueRetargets(limit = 25) {
  const result = await pool.query<RetargetRow>(
    `
      SELECT r.id, r.email, r.campaign_id, r.provider_lead_id, r.company_name,
             r.return_date, r.original_thread, r.alternate_contact,
             rc.event_id AS original_event_id
      FROM scheduled_retargets r
      LEFT JOIN reply_classifications rc ON rc.id = r.reply_classification_id
      WHERE r.status = 'scheduled' AND r.run_after <= now()
      ORDER BY r.run_after
      LIMIT $1
      FOR UPDATE OF r SKIP LOCKED
    `,
    [limit]
  );
  return result.rows;
}

export interface AwayLeadRow {
  email: string;
  company_name: string | null;
  reason: string;
  created_at: string;
  ooo_return_date: Date | null;
  ooo_alternate_contact: string | null;
  raw_thread: string | null;
  retarget_id: string | null;
  retarget_run_after: string | null;
}

/** An auto-reply this old is history, not something you are still waiting on. */
const AWAY_MAX_AGE_DAYS = 60;

/**
 * Leads whose most recent reply was an autoresponder and who are still worth
 * waiting on. Backs the Inbox "Away" section — without it an out_of_office
 * classification is invisible and a scheduled retarget has no screen at all.
 *
 * A lead leaves this list three ways, and each needs its own guard:
 *  - they come back and reply for real, so their newest classification is some
 *    other intent (the latest CTE, rather than filtering to out_of_office first,
 *    which would pin them here forever)
 *  - their follow-up drafts, moving them to "Waiting on you" — note the retarget
 *    writes another out_of_office row, so intent alone cannot tell them apart
 *  - nothing happens for two months and the auto-reply ages out
 */
export async function listAwayLeads(limit = 40): Promise<AwayLeadRow[]> {
  const result = await pool.query<AwayLeadRow>(
    `
      WITH latest AS (
        SELECT DISTINCT ON (lower(email))
          email, company_name, intent, reason, created_at,
          ooo_return_date, ooo_alternate_contact, raw_thread
        FROM reply_classifications
        WHERE email IS NOT NULL
        ORDER BY lower(email), created_at DESC
      )
      SELECT
        rc.email,
        rc.company_name,
        rc.reason,
        rc.created_at::text,
        rc.ooo_return_date,
        rc.ooo_alternate_contact,
        rc.raw_thread,
        r.id AS retarget_id,
        r.run_after::text AS retarget_run_after
      FROM latest rc
      LEFT JOIN scheduled_retargets r
        ON lower(r.email) = lower(rc.email) AND r.status = 'scheduled'
      WHERE rc.intent = 'out_of_office'
        AND rc.created_at > now() - ($2 || ' days')::interval
        AND NOT EXISTS (
          SELECT 1
          FROM drafts d
          JOIN reply_classifications rc2 ON rc2.id = d.reply_classification_id
          WHERE lower(rc2.email) = lower(rc.email) AND d.status = 'drafted'
        )
      LIMIT $1
    `,
    [limit, AWAY_MAX_AGE_DAYS]
  );
  // Soonest return first; the dateless ones sit at the bottom.
  return result.rows.sort((a, b) => {
    const aDate = a.ooo_return_date ? a.ooo_return_date.getTime() : Number.POSITIVE_INFINITY;
    const bDate = b.ooo_return_date ? b.ooo_return_date.getTime() : Number.POSITIVE_INFINITY;
    return aDate - bDate || a.email.localeCompare(b.email);
  });
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
