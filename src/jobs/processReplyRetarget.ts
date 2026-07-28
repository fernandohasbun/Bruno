import { draftRetarget } from "../agents/draftingAgent.js";
import { findKintaPersonaByCampaignName } from "../campaigns/kintaPersonaCampaigns.js";
import { getInstantlyCampaign } from "../integrations/instantly.js";
import { activateAlertOnce, clearAlertOnce, isAgentPaused } from "../db/config.js";
import { saveDraft, saveReplyClassification } from "../db/replyRecords.js";
import { cancelRetargetById, claimDueRetargets, markRetargetDrafted } from "../db/retargets.js";
import { isSuppressed } from "../db/suppressions.js";
import { notifyAlert } from "../integrations/notify.js";
import type { QueueJob } from "../queue/queue.js";

export interface ReplyRetargetPayload {
  limit?: number;
}

/**
 * Map a campaign id to the persona that campaign sells, so the re-approach
 * restates the offer the prospect was actually sent. Campaign names are looked
 * up once per sweep. A lookup failure only costs the draft its persona context,
 * so it degrades to a generic re-approach rather than failing the job.
 */
async function resolvePersona(
  campaignId: string | null,
  campaignNames: Map<string, string | undefined>
) {
  if (!campaignId) return undefined;

  if (!campaignNames.has(campaignId)) {
    try {
      const campaign = await getInstantlyCampaign(campaignId);
      campaignNames.set(campaignId, campaign.name);
    } catch {
      campaignNames.set(campaignId, undefined);
    }
  }

  return findKintaPersonaByCampaignName(campaignNames.get(campaignId));
}

/**
 * Fires for leads whose out-of-office window has closed. Writes a re-approach
 * message into the normal approval queue — it never sends on its own.
 */
export async function processReplyRetargetJob(job: QueueJob) {
  const payload = (job.payload ?? {}) as ReplyRetargetPayload;

  if (await isAgentPaused()) {
    if (await activateAlertOnce("retarget-paused")) {
      await notifyAlert(
        "Agent kill switch is on. Out-of-office retargets stay scheduled and will draft once the agent resumes."
      );
    }
    return;
  }
  await clearAlertOnce("retarget-paused");

  const due = await claimDueRetargets(payload.limit ?? 25);
  // Campaign id -> name, resolved once per sweep and shared across the batch.
  const campaignNames = new Map<string, string | undefined>();

  for (const row of due) {
    // Someone may have unsubscribed or bounced during the weeks they were away.
    if (await isSuppressed(row.email)) {
      await cancelRetargetById(row.id, "contact suppressed before return date");
      continue;
    }

    const returnDate = row.return_date.toISOString().slice(0, 10);
    const persona = await resolvePersona(row.campaign_id, campaignNames);
    const draft = await draftRetarget({
      companyName: row.company_name ?? undefined,
      email: row.email,
      originalThread: row.original_thread ?? undefined,
      returnDate,
      targetRole: persona?.targetRole,
      workItem: persona?.workItem,
      originalOutbound: persona?.firstEmailVariants[0]?.body
    });

    // The retarget needs its own classification row to hang the draft off, so it
    // renders in the dashboard queue exactly like any other pending draft.
    const replyClassificationId = await saveReplyClassification({
      // Inherit the autoresponder's event so the dashboard can resolve the
      // Instantly message reference and Approve actually sends.
      eventId: row.original_event_id ?? undefined,
      email: row.email,
      companyName: row.company_name ?? undefined,
      classification: {
        intent: "out_of_office",
        confidence: 1,
        reason: `Out-of-office window closed; prospect was back on ${returnDate}.`,
        suggestedNextAction: "Review and send the re-approach message."
      },
      rawThread: row.original_thread ?? undefined
    });

    const draftId = await saveDraft({ replyClassificationId, draft });
    await markRetargetDrafted(row.id, draftId);
  }
}
