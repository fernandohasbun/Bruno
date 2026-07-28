import assert from "node:assert/strict";
import test from "node:test";
import { heuristicClassifyReply, normalizeOutOfOffice } from "../src/agents/replyIntentAgent.js";
import {
  KINTA_PERSONA_CAMPAIGNS,
  findKintaPersonaByCampaignName
} from "../src/campaigns/kintaPersonaCampaigns.js";
import { retargetRunAfter } from "../src/db/retargets.js";
import { normalizeInstantlyEvent } from "../src/webhooks/normalizeInstantlyEvent.js";
import type { ReplyClassification } from "../src/types/domain.js";

/** The six autoresponders the P2 Legal campaign actually received, verbatim. */
const REAL_AUTORESPONDERS = [
  {
    subject: "Out of Office Re: your paralegal comes with an office",
    body: "Hello, I am traveling and will not be back at my desk until July 30. If this is urgent, please contact Joel Cohen."
  },
  {
    subject: "Automatic reply: 8am, your time",
    body: "Please be advised that I am out of the office with limited access to email. For assistance, please contact our main line."
  },
  {
    subject: "Automatic reply: 8am, your time",
    body: "Thank you for your email. I am out of the office on a medical leave. Please call the office for assistance."
  },
  {
    subject: "Automatic reply: 8am, your time",
    body: "Greetings, I am out of the office at mediation. I am out of state and will have extremely limited to no access to email."
  },
  {
    subject: "Delayed response Re: billable hours back, every week",
    body: "I am away from y desk today and may be delayed in responding. If the matter is urgent please message me at 347..."
  },
  {
    subject: "Out of Office - Maternity Leave Re: billable hours back, every week",
    body: "Thank you for your email. I am currently out of the office on maternity leave. I will respond to your message on my return."
  }
];

test("every real autoresponder from the legal campaign is labelled out_of_office", () => {
  for (const message of REAL_AUTORESPONDERS) {
    const result = heuristicClassifyReply(message.subject, message.body);
    assert.equal(
      result.intent,
      "out_of_office",
      `misclassified as ${result.intent}: ${message.subject}`
    );
  }
});

test("an autoresponder mentioning a phone call is not mistaken for interest", () => {
  // "please call the office" would hit the positive branch if absence were not
  // checked first — that is the misfire that stops a live sequence.
  const result = heuristicClassifyReply(
    "Automatic reply: 8am, your time",
    "Thank you for your email. I am out of the office on a medical leave. Please call the office for assistance."
  );
  assert.equal(result.intent, "out_of_office");
});

test("genuine human replies are not swept into out_of_office", () => {
  assert.equal(
    heuristicClassifyReply("Re: your paralegal comes with an office", "Not interested, thanks.").intent,
    "negative"
  );
  assert.equal(
    heuristicClassifyReply("Re: billable hours back", "Yes — send more detail and we can book a call.").intent,
    "positive"
  );
  assert.equal(
    heuristicClassifyReply("Re: 8am, your time", "Please remove me from your list.").intent,
    "unsubscribe"
  );
});

const baseOoo: ReplyClassification = {
  intent: "out_of_office",
  confidence: 0.95,
  reason: "Autoresponder.",
  suggestedNextAction: "Hold and re-approach.",
  outOfOffice: { dateConfidence: 0.9, returnDate: "2026-07-30" }
};

test("a usable return date survives normalization", () => {
  const result = normalizeOutOfOffice(baseOoo, new Date("2026-07-28T12:00:00.000Z"));
  assert.equal(result.outOfOffice?.returnDate, "2026-07-30");
});

test("a return date already in the past is dropped rather than fired immediately", () => {
  const result = normalizeOutOfOffice(baseOoo, new Date("2026-08-15T12:00:00.000Z"));
  assert.equal(result.outOfOffice?.returnDate, undefined);
  assert.equal(result.outOfOffice?.dateConfidence, 0);
});

test("an absurdly distant return date is dropped", () => {
  const result = normalizeOutOfOffice(
    { ...baseOoo, outOfOffice: { dateConfidence: 0.9, returnDate: "2031-01-01" } },
    new Date("2026-07-28T12:00:00.000Z")
  );
  assert.equal(result.outOfOffice?.returnDate, undefined);
});

test("a malformed return date is dropped", () => {
  const result = normalizeOutOfOffice(
    { ...baseOoo, outOfOffice: { dateConfidence: 0.9, returnDate: "next Monday" } },
    new Date("2026-07-28T12:00:00.000Z")
  );
  assert.equal(result.outOfOffice?.returnDate, undefined);
});

test("returning today is still schedulable", () => {
  const result = normalizeOutOfOffice(
    { ...baseOoo, outOfOffice: { dateConfidence: 0.9, returnDate: "2026-07-28" } },
    new Date("2026-07-28T12:00:00.000Z")
  );
  assert.equal(result.outOfOffice?.returnDate, "2026-07-28");
});

test("non-OOO intents never carry absence detail", () => {
  const result = normalizeOutOfOffice({ ...baseOoo, intent: "positive" }, new Date("2026-07-28T12:00:00.000Z"));
  assert.equal(result.outOfOffice, undefined);
});

test("the retarget lands mid-morning on the return date, not at midnight", () => {
  assert.equal(retargetRunAfter("2026-07-30").toISOString(), "2026-07-30T14:00:00.000Z");
});

test("live campaign names still resolve to a persona", () => {
  // The retarget's offer context hangs on an exact name match, so renaming a
  // campaign in Instantly without updating the registry would silently strip the
  // persona and let the draft invent a role.
  const legal = findKintaPersonaByCampaignName("Kinta | P2 Legal | B1 | 2026-07");
  assert.equal(legal?.targetRole, "Paralegal");
  assert.equal(legal?.workItem, "case files");

  for (const persona of KINTA_PERSONA_CAMPAIGNS) {
    assert.ok(findKintaPersonaByCampaignName(persona.name), `unresolvable: ${persona.name}`);
  }

  assert.equal(findKintaPersonaByCampaignName("Kinta | P2 Legal | B2 | 2026-08"), undefined);
  assert.equal(findKintaPersonaByCampaignName(undefined), undefined);
});

test("the reply subject reaches the classifier", () => {
  const event = normalizeInstantlyEvent({
    event_type: "email.received",
    data: {
      id: "email-1",
      email: "lead@example.com",
      subject: "Automatic reply: 8am, your time",
      thread_text: "I am out of the office.",
      campaign_id: "campaign-1"
    }
  });
  assert.equal(event.subject, "Automatic reply: 8am, your time");
});
