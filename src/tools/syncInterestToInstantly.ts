/**
 * Push Bruno's read into Instantly's pipeline field for leads classified before
 * Bruno started writing it.
 *
 * Instantly sets interest_status = 1 ("interested") on any reply without reading
 * it. Two live examples: an autoresponder listing scheduling contacts, and a
 * refusal citing CJIS compliance rules — both stored as interested. Bruno read
 * both correctly, so its verdict is the better value.
 *
 * Leaves alone any lead a human advanced to a meeting or close, and any intent
 * with no pipeline meaning (question, objection, not_now — still live).
 *
 * Dry run (default) prints the plan and writes nothing:
 *   node dist/tools/syncInterestToInstantly.js
 * Apply:
 *   node dist/tools/syncInterestToInstantly.js --apply
 */
import "dotenv/config";
import { pool, closePool } from "../db/pool.js";
import {
  getLeadRecord,
  interestStatusLabel,
  interestValueForIntent,
  isHumanAdvancedInterest,
  setLeadInterest
} from "../integrations/instantly.js";

const APPLY = process.argv.includes("--apply");

interface Row {
  email: string;
  intent: string;
  campaign_id: string | null;
}

async function main() {
  const { rows } = await pool.query<Row>(`
    SELECT DISTINCT ON (lower(rc.email))
      rc.email,
      rc.intent,
      l.campaign_id
    FROM reply_classifications rc
    LEFT JOIN crm_leads l ON lower(l.email) = lower(rc.email)
    WHERE rc.email IS NOT NULL
    ORDER BY lower(rc.email), rc.created_at DESC
  `);

  console.log(`${rows.length} classified leads${APPLY ? "" : "   (DRY RUN — nothing will be written)"}\n`);

  let changed = 0;
  let skipped = 0;

  for (const row of rows) {
    const target = interestValueForIntent(row.intent);
    if (target === undefined) {
      console.log(`  skip    ${row.email.padEnd(34)} ${row.intent} — no pipeline meaning`);
      skipped++;
      continue;
    }

    const record = await getLeadRecord({ email: row.email, campaignId: row.campaign_id ?? undefined });
    const current = record?.interestStatus;

    if (isHumanAdvancedInterest(current)) {
      console.log(`  skip    ${row.email.padEnd(34)} human set "${interestStatusLabel(current)}" — left alone`);
      skipped++;
      continue;
    }
    if (current === target) {
      console.log(`  ok      ${row.email.padEnd(34)} already "${interestStatusLabel(current) ?? current}"`);
      continue;
    }

    console.log(
      `  UPDATE  ${row.email.padEnd(34)} "${interestStatusLabel(current) ?? current ?? "unset"}" -> "${interestStatusLabel(target)}"   (Bruno: ${row.intent})`
    );
    changed++;

    if (APPLY) {
      await setLeadInterest({
        email: row.email,
        interestValue: target,
        campaignId: row.campaign_id ?? undefined
      });
    }
  }

  console.log(
    `\n${changed} to correct, ${skipped} left alone.` + (APPLY ? "" : "\nRe-run with --apply to write these changes.")
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(closePool);
