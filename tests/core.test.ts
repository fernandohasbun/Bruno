import assert from "node:assert/strict";
import test from "node:test";
import {
  KINTA_BOOKING_URL,
  KINTA_PERSONA_CAMPAIGNS,
  buildKintaPersonaCampaignPayload
} from "../src/campaigns/kintaPersonaCampaigns.js";
import {
  normalizeEmailRecord,
  plainTextToEmailHtml
} from "../src/integrations/instantly.js";

test("the message ledger normalization preserves exact sent and received bodies", () => {
  const received = normalizeEmailRecord({
    id: "email-received-1",
    ue_type: 2,
    lead: "lead@example.com",
    campaign_id: "campaign-1",
    eaccount: "alex@workwithkinta.com",
    timestamp_email: "2026-07-24T14:00:00.000Z",
    subject: "Re: your ea comes with an office",
    body: { text: "Yes — can you send pricing?\n\nThanks." },
    step: "2",
    variant: 1
  });
  assert.equal(received.direction, "received");
  assert.equal(received.bodyText, "Yes — can you send pricing?\n\nThanks.");
  assert.equal(received.leadEmail, "lead@example.com");
  assert.equal(received.step, "2");
  assert.equal(received.variant, "1");

  const sent = normalizeEmailRecord({
    id: "email-sent-1",
    ue_type: 1,
    lead: "lead@example.com",
    body: {
      html: "<p>Hello there,</p><p>Exact rendered copy.</p>"
    }
  });
  assert.equal(sent.direction, "sent");
  assert.equal(sent.bodyHtml, "<p>Hello there,</p><p>Exact rendered copy.</p>");
  assert.equal(sent.preview, "Hello there, Exact rendered copy.");
});

test("reply HTML escapes prospect-controlled markup and preserves paragraphs", () => {
  assert.equal(
    plainTextToEmailHtml("Hi <there> & team,\n\nBook when ready."),
    "<p>Hi &lt;there&gt; &amp; team,</p><p>Book when ready.</p>"
  );
});

test("all five persona campaigns keep the approved sending and link rules", () => {
  assert.equal(KINTA_PERSONA_CAMPAIGNS.length, 5);
  for (const persona of KINTA_PERSONA_CAMPAIGNS) {
    const payload = buildKintaPersonaCampaignPayload({
      persona,
      senderEmails: ["alex@workwithkinta.com"]
    });
    const schedule = payload.campaign_schedule.schedules[0];
    assert.deepEqual(schedule.timing, { from: "07:00", to: "12:00" });
    assert.deepEqual(schedule.days, {
      "0": false,
      "1": true,
      "2": true,
      "3": true,
      "4": true,
      "5": true,
      "6": false
    });
    assert.equal(payload.link_tracking, false);
    assert.equal(payload.open_tracking, false);
    assert.equal(payload.first_email_text_only, true);
    assert.equal(payload.sequences?.[0]?.steps.length, 5);

    const [first, ...followups] = payload.sequences?.[0]?.steps ?? [];
    for (const variant of first?.variants ?? []) {
      assert.doesNotMatch(variant.body, /href=/i);
      assert.match(variant.body, /\{\{sendingAccountFirstName\}\}/);
    }
    for (const step of followups.slice(0, 3)) {
      const body = step.variants[0]?.body ?? "";
      assert.match(body, new RegExp(KINTA_BOOKING_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(body, />You can schedule a call with us<\/a>/);
      assert.match(body, /\{\{sendingAccountFirstName\}\}/);
    }
    assert.doesNotMatch(followups[3]?.variants[0]?.body ?? "", /href=/i);
  }
});
