/**
 * Re-read stored replies with the out-of-office classifier and repair the ones
 * that predate it.
 *
 * Classifications are written once, when the reply arrives, so autoresponders
 * received before out_of_office existed are frozen as "unclear" or, worse, as a
 * real intent like not_now. This walks them again and, only where the new
 * classifier says out_of_office, rewrites the row and schedules a retarget for
 * any return date still in the future.
 *
 * Safe to re-run: rows already labelled out_of_office are skipped, and the
 * scheduled_retargets upsert keeps one pending row per lead per campaign.
 *
 * Dry run (default) prints the plan and writes nothing:
 *   node dist/tools/backfillOutOfOffice.js
 * Apply:
 *   node dist/tools/backfillOutOfOffice.js --apply
 *
 * Locally the same two commands work via `npm run backfill:ooo`.
 */
import "dotenv/config";
import { classifyReply } from "../agents/replyIntentAgent.js";
import { pool, closePool } from "../db/pool.js";
import { scheduleRetarget, retargetRunAfter } from "../db/retargets.js";

const APPLY = process.argv.includes("--apply");

interface CandidateRow {
  id: string;
  email: string | null;
  company_name: string | null;
  intent: string;
  raw_thread: string | null;
  created_at: Date;
  event_id: string | null;
  campaign_id: string | null;
  provider_lead_id: string | null;
  subject: string | null;
}

/**
 * Everything not already labelled out_of_office that still has text to re-read.
 * Deliberately not filtered by keyword: the whole point is to let the classifier
 * decide, and a keyword prefilter would re-introduce the guesswork it replaces.
 * Only rows it calls out_of_office are touched.
 */
async function loadCandidates() {
  const result = await pool.query<CandidateRow>(`
    SELECT
      rc.id,
      rc.email,
      rc.company_name,
      rc.intent,
      rc.raw_thread,
      rc.created_at,
      rc.event_id,
      e.payload -> 'data' ->> 'campaign_id' AS campaign_id,
      e.payload -> 'data' ->> 'lead_id'     AS provider_lead_id,
      COALESCE(
        e.payload -> 'data' ->> 'subject',
        (SELECT m.subject FROM crm_messages m
          WHERE lower(m.lead_email) = lower(rc.email)
            AND m.direction = 'received'
          ORDER BY abs(EXTRACT(EPOCH FROM (m.timestamp_email - rc.created_at)))
          LIMIT 1)
      ) AS subject
    FROM reply_classifications rc
    LEFT JOIN events e ON e.id = rc.event_id
    WHERE rc.intent <> 'out_of_office'
      AND rc.raw_thread IS NOT NULL
      AND length(btrim(rc.raw_thread)) > 0
    ORDER BY rc.created_at DESC
  `);
  return result.rows;
}

async function main() {
  const candidates = await loadCandidates();
  console.log(`${candidates.length} stored replies to re-read${APPLY ? "" : "   (DRY RUN — nothing will be written)"}\n`);

  const today = new Date();
  let relabelled = 0;
  let scheduled = 0;

  for (const row of candidates) {
    const result = await classifyReply({
      companyName: row.company_name ?? undefined,
      email: row.email ?? undefined,
      subject: row.subject ?? undefined,
      threadText: row.raw_thread ?? "",
      now: today
    });

    if (result.intent !== "out_of_office") {
      console.log(`  keep    ${row.email}  ${row.intent} -> ${result.intent} (unchanged)`);
      continue;
    }

    const returnDate = result.outOfOffice?.returnDate;
    relabelled++;
    console.log(
      `  RELABEL ${row.email}  ${row.intent} -> out_of_office` +
        (returnDate ? `  back ${returnDate} -> retarget ${retargetRunAfter(returnDate).toISOString().slice(0, 16)}Z` : "  (no date, nothing scheduled)")
    );

    if (!APPLY) continue;

    await pool.query(
      `UPDATE reply_classifications
          SET intent = 'out_of_office',
              confidence = $2,
              reason = $3,
              suggested_next_action = $4,
              ooo_return_date = $5::date,
              ooo_alternate_contact = $6,
              ooo_date_confidence = $7
        WHERE id = $1`,
      [
        row.id,
        result.confidence,
        result.reason,
        result.suggestedNextAction,
        returnDate ?? null,
        result.outOfOffice?.alternateContact ?? null,
        result.outOfOffice?.dateConfidence ?? null
      ]
    );

    if (returnDate && row.email) {
      await scheduleRetarget({
        replyClassificationId: row.id,
        email: row.email,
        campaignId: row.campaign_id ?? undefined,
        providerLeadId: row.provider_lead_id ?? undefined,
        companyName: row.company_name ?? undefined,
        returnDate,
        originalThread: row.raw_thread ?? undefined,
        alternateContact: result.outOfOffice?.alternateContact
      });
      scheduled++;
    }
  }

  console.log(
    `\n${relabelled} relabelled as out_of_office, ${scheduled} retargets scheduled.` +
      (APPLY ? "" : "\nRe-run with --apply to write these changes.")
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closePool);
