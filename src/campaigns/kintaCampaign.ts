import type { InstantlyCampaignPayload } from "../integrations/instantly.js";

export const KINTA_CAMPAIGN_NAME = "Kinta Outbound Campaign - Nearshore Hiring";

// v2 copy (Kinta_Campaign_v2.docx): Email 1 is an A/B pair — Instantly runs the
// split natively when a step carries multiple enabled variants. Everyone gets
// the same Emails 2-5. Kill the losing variant once the winner holds 3%+
// replies over ~400 sends per arm.
//
// The doc writes variables Apollo-style ({{first_name}}); Instantly's built-in
// lead fields are camelCase ({{firstName}}, {{companyName}}) and Apollo CSV
// columns map onto them at upload, so camelCase is used here.
// "[First name]" sign-offs use {{sendingAccountFirstName}} so each of the
// sender inboxes signs with its own name.
const sequenceSteps = [
  {
    day: 1,
    delayFromPreviousStepDays: 0,
    variants: [
      {
        name: "A — hiring math",
        subject: "{{companyName}}'s hiring math",
        body: `Hi {{firstName}},

The salary is only part of what a hire costs — benefits, overhead, and turnover quietly push it far higher. Most companies end up paying double what the same role could cost.

At Kinta it's one flat fee, about half the base salary, everything included: a full-time bilingual professional, working your hours from our office in Central America — HR, equipment, and daily accountability all on us. If they leave, we replace them free.

Want to see the math for {{companyName}}? 15 minutes.

{{sendingAccountFirstName}}`
      },
      {
        name: "B — the question",
        subject: "which role would you fill first?",
        body: `{{firstName}} — honest question.

If you could hire a great full-time person for one flat fee — about half of what the role costs you today, with the office, HR, equipment, and daily accountability all handled — which role would you fill first?

That's Kinta. Our people work from our own office in Central America. We manage everything behind them. You get the output, and one predictable number.

Curious what came to mind.

{{sendingAccountFirstName}}`
      }
    ]
  },
  {
    day: 4,
    delayFromPreviousStepDays: 3,
    variants: [
      {
        name: "The proof",
        subject: "what a Kinta hire looks like",
        body: `Hi {{firstName}},

She's at her desk in our office by 8am your time. Bilingual, university-educated, fully equipped. Our HR team is down the hall, and her manager reviews her work daily.

To you, she's just a team member on Slack — except she costs about half of the same hire in the US, and if she ever leaves, we replace her at no cost.

That's the whole model. We built the environment. You get the talent.

Worth seeing how it would work for {{companyName}}?

{{sendingAccountFirstName}}`
      }
    ]
  },
  {
    day: 8,
    delayFromPreviousStepDays: 4,
    variants: [
      {
        name: "The differentiator",
        subject: "not freelancers. not a job board.",
        body: `Hi {{firstName}},

Every remote hiring option you've seen has the same flaw: after the placement, you're on your own.

Freelancer disappears? Your problem. Remote hire underperforms? Your problem. That's why most founders who tried it once never try again.

We built Kinta differently. Our people work from our physical office — real workspace, real HR, real daily management. When something breaks, we fix it. When someone leaves, we replace them. Guaranteed.

One person or a small team, the model is the same: you get the output, we run everything behind it.

Worth 15 minutes?

{{sendingAccountFirstName}}`
      }
    ]
  },
  {
    day: 15,
    delayFromPreviousStepDays: 7,
    variants: [
      {
        name: "The objection handler",
        subject: "the reason it didn't work last time",
        body: `Hi {{firstName}},

If you've tried remote hiring and it fell apart, I'd bet on why: it wasn't the person. It was that nobody was accountable for them.

No onboarding. No manager. No one to call when things slipped. The talent was fine — the structure didn't exist.

That structure is literally what Kinta is. Office, HR, daily oversight, culture, replacement guarantee. We're not selling you a person and walking away. We're running the environment that makes the person work.

If a bad past experience is what's kept {{companyName}} from looking at this again — that's exactly the conversation worth having.

{{sendingAccountFirstName}}`
      }
    ]
  },
  {
    day: 21,
    delayFromPreviousStepDays: 6,
    variants: [
      {
        name: "The breakup",
        subject: "closing your file",
        body: `Hi {{firstName}},

I'll stop here — don't want to be noise in your inbox.

If the timing isn't right for {{companyName}}, no problem at all. If hiring costs become a priority later, just reply and I'll pick it back up.

And if someone else on your team owns this, I'd appreciate the pointer.

Thanks either way.

{{sendingAccountFirstName}}`
      }
    ]
  }
];

export function buildKintaCampaignPayload(input: {
  senderEmails: string[];
  startDate?: string;
  endDate?: string;
}): InstantlyCampaignPayload {
  return {
    name: KINTA_CAMPAIGN_NAME,
    campaign_schedule: {
      schedules: [
        {
          name: "Weekday mornings EST",
          timing: {
            from: "07:00",
            to: "12:00"
          },
          // Instantly indexes Sunday as 0; send Monday-Friday only.
          days: {
            "0": false,
            "1": true,
            "2": true,
            "3": true,
            "4": true,
            "5": true,
            "6": false
          },
          // Instantly's timezone enum has no "America/New_York"; "America/Detroit" is the valid US Eastern value.
          timezone: "America/Detroit"
        }
      ],
      start_date: input.startDate ?? "2026-07-07",
      end_date: input.endDate
    },
    pl_value: 100,
    is_evergreen: false,
    sequences: [
      {
        // Instantly's step `delay` = days to wait AFTER this step before the NEXT email.
        // So each step must carry the gap to the *following* email (last step = 0).
        // (delayFromPreviousStepDays is the gap *before* a step, hence the +1 lookahead.)
        steps: sequenceSteps.map((step, i) => ({
          type: "email",
          delay: sequenceSteps[i + 1]?.delayFromPreviousStepDays ?? 0,
          delay_unit: "days",
          // pre_delay only applies to subsequences and is ignored for regular campaigns.
          pre_delay: 0,
          pre_delay_unit: "days",
          variants: step.variants.map((variant) => ({
            subject: variant.subject,
            body: variant.body,
            v_disabled: false
          }))
        }))
      }
    ],
    email_gap: 15,
    random_wait_max: 15,
    text_only: true,
    first_email_text_only: true,
    email_list: input.senderEmails,
    // 400 leads/week target across 2 inboxes; the window is Mon-Fri, so the weekly
    // target is hit in ~3 sending days and this cap is the per-day ceiling, not a plan.
    // Do not raise past this until the winning Email 1 variant holds a reply rate above 3%
    // (then scale toward 10 inboxes / 2,000 per week).
    daily_limit: 135,
    stop_on_reply: true,
    link_tracking: false,
    open_tracking: false,
    stop_on_auto_reply: false,
    daily_max_leads: 135,
    prioritize_new_leads: false,
    match_lead_esp: false,
    stop_for_company: true,
    insert_unsubscribe_header: true,
    allow_risky_contacts: false,
    disable_bounce_protect: false,
    limit_emails_per_company_override: {
      mode: "custom",
      daily_limit: 1,
      scope: "per_campaign"
    }
  };
}

export function getKintaCampaignSummary() {
  return sequenceSteps.map((step) => ({
    day: step.day,
    variants: step.variants.map((variant) => ({
      name: variant.name,
      subject: variant.subject,
      preview: variant.body.split("\n\n")[1] ?? variant.body
    }))
  }));
}
