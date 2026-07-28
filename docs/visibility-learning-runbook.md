# Bruno visibility, learning, and control runbook

## What is built

Bruno now keeps two synchronized Postgres read models:

- `crm_leads`: every Instantly lead, with campaign, sequence state, interest state, engagement counters, identity, and custom persona fields.
- `crm_messages`: the account-wide sent/received/manual ledger, including the rendered text and HTML body, campaign, sender inbox, step, variant, thread, and provider timestamps.

Instantly remains the transactional source of truth. The mirrors are queryable memory and can be rebuilt. Cursor/watermark checkpoints make the email import incremental, while a full lead scan removes records only after a complete successful pass.

The dashboard exposes:

- **Leads:** exact totals, full-dataset search/filtering, and server pagination.
- **Activity:** exact message-body audit with lead, sender, direction, date, step, and variant filters.
- **Campaign:** confirmed pause/resume and daily-limit controls for the five managed Kinta campaigns only.
- **Learning:** proposed/active/rejected/retired rules with evidence and owner approval.
- **System:** sync health, provider/local reconciliation, failed jobs, and the control audit.

Bruno chat has matching tools for exact CRM totals, paginated lead/message queries, sync health, per-lead history, lesson review, and confirmed campaign controls.

## Learning boundary

The weekly learning review compares Bruno's original drafts with owner-edited final sends. Claude may propose a short rule only when at least two approval records support the same pattern. A proposal does not affect any prompt. It becomes drafting guidance only after the owner activates it in Learning (or explicitly confirms it in chat).

Active lessons and a few owner-approved objection examples are injected into future drafting prompts. This is prompt-side memory, not autonomous model training or fine-tuning.

## Deployment behavior

`npm start` runs migration `006_visibility_learning_control.sql` before boot. Startup then queues one lead backfill and one message backfill. Singleton queue checks plus Postgres advisory locks prevent overlapping scans.

Expected initial behavior:

1. Activity may say “backfill running” while old messages arrive in batches.
2. Leads should complete in one pass for the current ~2,500-record workspace.
3. System will show a provider/local mismatch until both backfills have caught up.
4. Reconciliation clears the alert after the next matching pass.

No startup or sync job activates a campaign, changes copy, alters a schedule, sends a cold email, or applies a learned lesson.

## Operator checks after deploy

1. Open `/dashboard/system` and confirm both `crm.leads.full` and `crm.messages.incremental` have a recent `ok` result.
2. Open `/dashboard/leads` and confirm the “all synchronized” count matches the expected workspace count.
3. Open `/dashboard/activity`, filter one known lead, and expand a row to verify the exact sent body.
4. Confirm all reconciliation rows say `matches`.
5. Open `/dashboard/learning`; proposed rules may be reviewed, but should not be activated without reading their evidence.

If a sync fails, System shows the provider error and the normal job retry policy applies. Campaign sending in Instantly is not paused by a read-sync failure.
