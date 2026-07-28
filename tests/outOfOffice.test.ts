import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { heuristicClassifyReply, normalizeOutOfOffice } from "../src/agents/replyIntentAgent.js";
import {
  KINTA_PERSONA_CAMPAIGNS,
  findKintaPersonaByCampaignName
} from "../src/campaigns/kintaPersonaCampaigns.js";
import { CRM_LEAD_VIEWS } from "../src/db/crm.js";
import { retargetRunAfter } from "../src/db/retargets.js";
import { normalizeInstantlyEvent } from "../src/webhooks/normalizeInstantlyEvent.js";
import { inboxSection, isReplyIntent } from "../src/dashboard/routes.js";
import type { ReplyClassification, ReplyIntent } from "../src/types/domain.js";

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

test("the roster separates contacted from merely imported", () => {
  // Instantly marks every imported lead status 1, so "in sequence" counts the
  // import list, not anyone emailed — 499 vs 23 on P2 Legal. Only last_contact_at
  // records an actual send, so the two views must not share a predicate.
  const sql = readFileSync(new URL("../src/db/crm.ts", import.meta.url), "utf8");
  const query = sql.slice(sql.indexOf("export async function listCrmLeadsPage"));

  assert.match(query, /'contacted' AND l\.last_contact_at IS NOT NULL/);
  assert.match(query, /'in-sequence' AND l\.status IN \(1, 2\)/);
  assert.match(query, /'no-reply'[\s\S]*?l\.email_reply_count = 0/);

  // Bruno's read comes from the newest classification, not an arbitrary one.
  assert.match(query, /LEFT JOIN LATERAL[\s\S]*?ORDER BY rc\.created_at DESC[\s\S]*?LIMIT 1/);

  for (const view of ["all", "contacted", "no-reply", "away", "needs-read"]) {
    assert.ok(CRM_LEAD_VIEWS.includes(view as never), `roster view missing: ${view}`);
  }
});

test("the away list is documented to clear three ways", () => {
  // Regression guard for a query that filtered to out_of_office before picking
  // the latest row per lead, so nobody ever left the section: a lead who later
  // replied for real stayed listed forever, alongside their own hot draft.
  const sql = readFileSync(new URL("../src/db/retargets.ts", import.meta.url), "utf8");
  const query = sql.slice(sql.indexOf("export async function listAwayLeads"));

  // The latest row per lead must be chosen before intent is filtered.
  const latestCte = query.indexOf("WITH latest AS");
  const intentFilter = query.indexOf("rc.intent = 'out_of_office'");
  assert.ok(latestCte !== -1, "away query must resolve the latest classification per lead first");
  assert.ok(intentFilter > latestCte, "intent must be filtered after the latest row is picked, not before");

  // A pending draft means they moved to "Waiting on you" — they cannot be in both.
  assert.ok(/NOT EXISTS[\s\S]*d\.status = 'drafted'/.test(query), "away query must exclude leads with a pending draft");

  // And stale auto-replies age out rather than accumulating forever.
  assert.ok(/created_at > now\(\) - /.test(query), "away query must bound how old an auto-reply can be");
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

test("every intent routes to exactly one inbox section", () => {
  // The original bug: sections were picked by membership in two arrays, so
  // out_of_office matched neither and rendered nowhere. Every intent must land.
  const intents: ReplyIntent[] = [
    "positive",
    "question",
    "objection",
    "not_now",
    "negative",
    "unsubscribe",
    "out_of_office",
    "unclear"
  ];
  const sections = new Set<string>();
  for (const intent of intents) {
    const section = inboxSection(intent);
    assert.ok(
      ["waiting", "needs_read", "away", "handled"].includes(section),
      `${intent} routed to an unknown section: ${section}`
    );
    sections.add(section);
  }
  assert.equal(inboxSection("out_of_office"), "away");
  assert.equal(inboxSection("positive"), "waiting");
  assert.equal(inboxSection("unclear"), "needs_read");
  assert.equal(inboxSection("unsubscribe"), "handled");
  // All four sections are reachable — none is dead code.
  assert.equal(sections.size, 4);
});

test("stored intents outside the current set are recognised as such", () => {
  assert.equal(isReplyIntent("out_of_office"), true);
  assert.equal(isReplyIntent("some_future_intent"), false);
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
