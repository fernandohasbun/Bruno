import { classifyReply } from "../agents/replyIntentAgent.js";
import { draftReply } from "../agents/draftingAgent.js";
import { activateAlertOnce, clearAlertOnce, isAgentPaused } from "../db/config.js";
import { markEventProcessed } from "../db/events.js";
import { saveDraft, saveReplyClassification } from "../db/replyRecords.js";
import { saveSuppression } from "../db/suppressions.js";
import { cancelPendingRetargets, scheduleRetarget } from "../db/retargets.js";
import { stopLeadSequence, suppressLead } from "../integrations/instantly.js";
import { notifyAlert, notifyHotReply } from "../integrations/notify.js";
import { enqueueJob, type QueueJob } from "../queue/queue.js";
import type { InstantlyEvent } from "../types/domain.js";

interface InstantlyEventJobPayload {
  eventId: string;
  event: InstantlyEvent;
}

export async function processInstantlyEventJob(job: QueueJob) {
  const { eventId, event } = job.payload as InstantlyEventJobPayload;

  if (await isAgentPaused()) {
    if (await activateAlertOnce("instantly-event-paused")) {
      await notifyAlert("Agent kill switch is on. Deferring Instantly reply processing; no classifications or drafts will run while paused.");
    }
    await enqueueJob(job.name, job.payload, {
      runAfter: new Date(Date.now() + 10 * 60 * 1000),
      maxAttempts: job.maxAttempts
    });
    return;
  }
  await clearAlertOnce("instantly-event-paused");

  if (isBounce(event)) {
    await saveSuppression({
      email: event.email,
      provider: event.provider,
      providerLeadId: event.leadId,
      reason: "bounce",
      rawPayload: event.raw
    });
    await suppressLead({ email: event.email, leadId: event.leadId, reason: "bounce" });
    await markEventProcessed(eventId);
    return;
  }

  if (!isReply(event)) {
    await markEventProcessed(eventId);
    return;
  }

  const threadText = event.threadText ?? "";
  const classification = await classifyReply({
    companyName: event.companyName,
    email: event.email,
    subject: event.subject,
    threadText,
    providerAutoReplyHint: autoReplyHint(event)
  });

  const replyClassificationId = await saveReplyClassification({
    eventId,
    email: event.email,
    companyName: event.companyName,
    classification,
    rawThread: threadText
  });

  // An autoresponder is not a human decision: the sequence keeps running, nobody
  // gets paged, and no reply is drafted today. If it named a return date we hold
  // the lead and re-approach on the day they are back.
  if (classification.intent === "out_of_office") {
    const returnDate = classification.outOfOffice?.returnDate;
    if (returnDate && event.email) {
      await scheduleRetarget({
        replyClassificationId,
        email: event.email,
        campaignId: event.campaignId,
        providerLeadId: event.leadId,
        companyName: event.companyName,
        returnDate,
        originalThread: threadText,
        alternateContact: classification.outOfOffice?.alternateContact
      });
    }
    await markEventProcessed(eventId);
    return;
  }

  // Any genuine human reply supersedes a pending retarget — re-approaching a live
  // thread weeks later would read as if we never saw their response.
  if (event.email) {
    await cancelPendingRetargets({
      email: event.email,
      campaignId: event.campaignId,
      reason: `superseded by ${classification.intent} reply`
    });
  }

  const shouldDraft = ["positive", "question", "objection"].includes(classification.intent);
  const draft = shouldDraft
    ? await draftReply({
        companyName: event.companyName,
        email: event.email,
        threadText,
        classification
      })
    : undefined;

  if (draft) {
    await saveDraft({
      replyClassificationId,
      draft
    });
  }

  if (classification.intent === "unsubscribe" || classification.intent === "negative") {
    await saveSuppression({
      email: event.email,
      provider: event.provider,
      providerLeadId: event.leadId,
      reason: classification.intent,
      rawPayload: event.raw
    });
    await suppressLead({
      email: event.email,
      leadId: event.leadId,
      reason: classification.intent
    });
  }

  if (classification.intent === "positive" || classification.intent === "question" || classification.intent === "objection") {
    await stopLeadSequence({ email: event.email, leadId: event.leadId, campaignId: event.campaignId });
    await notifyHotReply(formatHotReply(event.companyName, classification.intent, classification.reason, draft?.body));
  }

  if (classification.intent === "unclear") {
    await notifyAlert(`Unclear reply intent for ${event.companyName ?? event.email ?? "unknown lead"}; needs human review.`);
  }

  await markEventProcessed(eventId);
}

/**
 * Instantly's per-email auto-reply flag, when it is set. Treated as a hint only:
 * observed autoresponders carry is_auto_reply=false on the /emails endpoint even
 * when campaign analytics counts them as automatic replies.
 */
function autoReplyHint(event: InstantlyEvent) {
  const raw = event.raw as Record<string, unknown> | undefined;
  const data = (raw?.data ?? raw) as Record<string, unknown> | undefined;
  const flag = data?.is_auto_reply;
  return flag === true || flag === 1;
}

function isReply(event: InstantlyEvent) {
  return /reply|replied|email_reply|email\.received|received/i.test(event.eventType);
}

function isBounce(event: InstantlyEvent) {
  return /bounce|bounced/i.test(event.eventType);
}

function formatHotReply(companyName: string | undefined, intent: string, reason: string, draft?: string) {
  return [
    `Hot reply: ${companyName ?? "Unknown company"}`,
    `Intent: ${intent}`,
    `Reason: ${reason}`,
    draft ? `Draft:\n${draft}` : undefined
  ]
    .filter(Boolean)
    .join("\n\n");
}
