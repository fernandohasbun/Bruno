import type { InstantlyCampaignPayload } from "../integrations/instantly.js";

export const KINTA_BOOKING_URL = "https://calendly.com/kintalatam/kinta-latam";

export interface KintaPersonaCampaign {
  key: "ea" | "legal" | "developer" | "aec" | "social";
  name: string;
  persona: string;
  targetRole: string;
  workItem: string;
  firstEmailVariants: Array<{
    name: string;
    subject: string;
    body: string;
  }>;
}

const signoff = "{{sendingAccountFirstName}}";
const bookingLink = `<a href="${KINTA_BOOKING_URL}" style="text-decoration: underline;">You can schedule a call with us</a>`;

// Instantly sanitizes unwrapped text in HTML bodies. Wrap each short paragraph
// explicitly so the copy and its spacing survive normalization by the API.
function htmlEmail(body: string) {
  return body
    .split("\n\n")
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function applyLeadVariableFallbacks(body: string) {
  return body
    .replaceAll("{{firstName}}", "{{firstName | there}}")
    .replaceAll("{{companyName}}", "{{companyName | your team}}");
}

export const KINTA_PERSONA_CAMPAIGNS: KintaPersonaCampaign[] = [
  {
    key: "ea",
    name: "Kinta | P1 EA | B1 | 2026-07",
    persona: "EA",
    targetRole: "Executive Assistant",
    workItem: "inbox and calendar",
    firstEmailVariants: [
      {
        name: "A — the model",
        subject: "your ea comes with an office",
        body: `Hi {{firstName}},

Every Kinta executive assistant comes with more than their skills: a desk in our office in Central America, an office manager and HR on-site keeping the day running, all equipment included. Your hours — GMT-6, no drift.

You hire one person. You get the whole structure behind them.

And if the fit isn't right in the first 30 days, just tell us — we replace them free, and you don't pay for any days the seat sits empty.

About half the fully-loaded cost of a US hire.

Worth a look?

${signoff}`
      },
      {
        name: "B — the outcome",
        subject: "15 hours back, every week",
        body: `Hi {{firstName}},

That's what most founders get back within the first month of hiring a Kinta executive assistant.

One monthly fee — salary, office, equipment, HR, on-site support, all in. About half the fully-loaded cost of the same hire in the US.

They work your hours from our delivery center in Central America. Your calendar, your inbox, your follow-ups — handled.

And if the fit isn't right in the first 30 days, just tell us — we replace them free, and you don't pay for any days the seat sits empty.

Open to 15 minutes?

${signoff}`
      }
    ]
  },
  {
    key: "legal",
    name: "Kinta | P2 Legal | B1 | 2026-07",
    persona: "Legal",
    targetRole: "Paralegal",
    workItem: "case files",
    firstEmailVariants: [
      {
        name: "A — the model",
        subject: "your paralegal comes with an office",
        body: `Hi {{firstName}},

Every Kinta paralegal comes with more than their training: a desk in our office in Central America, an office manager and HR on-site, all equipment included. Your hours — GMT-6, real-time with your team.

Bilingual, detail-driven, and typically carrying real casework within the first few weeks.

If the fit isn't right in the first 30 days, just tell us — we replace them free, and you don't pay for any days the seat sits empty.

About half the fully-loaded cost of the same hire locally. Many firms add a legal EA next — same model, same guarantee.

Worth a look?

${signoff}`
      },
      {
        name: "B — the outcome",
        subject: "billable hours back, every week",
        body: `Hi {{firstName}},

Every hour you spend on intake forms, filings, and follow-ups is an hour you can't bill. That's the hour we give back.

A Kinta paralegal handles the support work — most are carrying real casework within the first few weeks. One monthly fee — salary, office, equipment, HR, on-site support, all in. About half the fully-loaded cost of hiring locally.

If the fit isn't right in the first 30 days, just tell us — we replace them free, and you don't pay for any days the seat sits empty.

Open to 15 minutes?

${signoff}`
      }
    ]
  },
  {
    key: "developer",
    name: "Kinta | P3 Developer | B1 | 2026-07",
    persona: "Developer",
    targetRole: "Software Developer",
    workItem: "repo",
    firstEmailVariants: [
      {
        name: "A — the model",
        subject: "your next dev comes with an office",
        body: `Hi {{firstName}},

Every Kinta developer comes with the full setup: a desk in our office in Central America, an office manager and HR on-site, equipment included. Your hours — GMT-6, so standups, pairing, and reviews happen in real time.

Our team handles everything but the code. You direct the work, we handle the rest.

If the fit isn't right in the first 30 days, just tell us — we replace them free, and you don't pay for any days the seat sits empty.

Mid and senior levels, at roughly half the fully-loaded US cost. Most teams start with one and grow the pod from there.

Worth a look?

${signoff}`
      },
      {
        name: "B — the outcome",
        subject: "an engineer in your timezone",
        body: `Hi {{firstName}},

Bilingual mid and senior engineers, working your hours from our office in Central America. Real-time collaboration all day — standups, reviews, pairing, no overnight handoffs.

One monthly fee — salary, office, equipment, HR, on-site support, all in. Roughly half the fully-loaded US cost per engineer.

You direct the work. We handle everything around it. And if the fit isn't right in the first 30 days, just tell us — we replace them free, and you don't pay for any days the seat sits empty.

Start with one, grow the pod when it works.

Open to 15 minutes?

${signoff}`
      }
    ]
  },
  {
    key: "aec",
    name: "Kinta | P4 AEC | B1 | 2026-07",
    persona: "AEC",
    targetRole: "BIM Modeler",
    workItem: "project files",
    firstEmailVariants: [
      {
        name: "A — the model",
        subject: "we run a design firm too",
        body: `Hi {{firstName}},

Before Kinta, we built an architecture and design practice of our own — so we know exactly what a good production architect or BIM modeler is worth, and how hard they are to find.

Ours work from our office in Central America: office manager and HR on-site, full setup included, your hours — GMT-6, live coordination all day. You set the standards and review the drawings.

If the fit isn't right in the first 30 days, just tell us — we replace them free, and you don't pay for any days the seat sits empty.

About half the fully-loaded US cost.

Worth a look?

${signoff}`
      },
      {
        name: "B — the outcome",
        subject: "revit, on your timezone",
        body: `Hi {{firstName}},

Bilingual production talent — Revit, AutoCAD, rendering — working your hours from our office in Central America. Live coordination all day, not overnight turnaround.

One monthly fee — salary, office, equipment, HR, on-site support, all in. About half the fully-loaded US cost.

And we run a design practice ourselves, so the vetting is done by people who've hired for these seats before.

If the fit isn't right in the first 30 days, just tell us — we replace them free, and you don't pay for any days the seat sits empty.

Open to 15 minutes?

${signoff}`
      }
    ]
  },
  {
    key: "social",
    name: "Kinta | P5 Social | B1 | 2026-07",
    persona: "Marketing",
    targetRole: "Social Media Manager",
    workItem: "content calendar",
    firstEmailVariants: [
      {
        name: "A — the model",
        subject: "your smm comes with an office",
        body: `Hi {{firstName}},

Every Kinta social media manager comes with the full setup: a desk in our office in Central America, an office manager and HR on-site, equipment included. Your hours — GMT-6, so they're online when your audience is.

Bilingual, brand-trained on your voice, and typically running a full content calendar within the first few weeks.

If the fit isn't right in the first 30 days, just tell us — we replace them free, and you don't pay for any days the seat sits empty.

About half the fully-loaded cost of the same hire in the US. Many brands add a designer next — same model, same guarantee.

Worth a look?

${signoff}`
      },
      {
        name: "B — the outcome",
        subject: "content out, every week",
        body: `Hi {{firstName}},

The hardest part of social isn't ideas — it's consistency. Posting every week, every channel, on brand, without it eating your team's time.

That's the seat we fill: a full-time Kinta social media manager, typically running a full content calendar within the first few weeks. One monthly fee — salary, office, equipment, HR, on-site support, all in. About half the fully-loaded US cost.

If the fit isn't right in the first 30 days, just tell us — we replace them free, and you don't pay for any days the seat sits empty.

Open to 15 minutes?

${signoff}`
      }
    ]
  }
];

function sharedFollowups(persona: KintaPersonaCampaign) {
  const role = persona.targetRole.toLowerCase();
  const work = `your ${persona.workItem}`;

  return [
    {
      subject: "8am, your time",
      body: htmlEmail(`Hi {{firstName}},

Here's what the model looks like on a Tuesday: your ${role} is at their desk in our office by 8am your time. Equipment set up, office manager on the floor, HR down the hall. They open ${work} and get to it.

To your team, they're one more person on Slack. Behind them, there's a whole structure keeping the seat running — that part's on us.

One monthly fee — salary, office, equipment, HR, on-site support, all in. About half the fully-loaded US cost.

Worth seeing how it would fit {{companyName}}?

${bookingLink}

${signoff}`)
    },
    {
      subject: "the question we kept getting",
      body: htmlEmail(`Hi {{firstName}},

US founders who visited our companies kept asking the same thing: where do you find these people?

Honest answer: we spent 15 years building businesses — fintech, manufacturing, architecture — and hired bilingual talent in Central America for our own teams. Real office, real support, real careers. It became the best part of how we operated.

Kinta is that system, opened up to US companies. Full-time professionals, working your hours, with everything handled behind them. And if the fit isn't right in the first 30 days, just tell us — we replace them free, and you don't pay for any days the seat sits empty.

Worth a look?

${bookingLink}

${signoff}`)
    },
    {
      subject: "ten founding clients",
      body: htmlEmail(`Hi {{firstName}},

We're taking ten founding clients this year. Not a discount program — full price, and in exchange for a case study and a couple of intros, founding clients get us: both founders on your calls, direct access, and first priority on talent.

Every seat comes with the same promise: if the fit isn't right in the first 30 days, just tell us — we replace them free, and you don't pay for any days the seat sits empty.

If {{companyName}} might want one, this is the right moment.

Open to 15 minutes?

${bookingLink}

${signoff}`)
    },
    {
      subject: "closing your file",
      body: htmlEmail(`Hi {{firstName}},

I'll stop here — don't want to be noise in your inbox.

If the timing isn't right for {{companyName}}, no problem at all. If it changes, just reply and I'll pick it back up — the fit guarantee will still be here.

And if someone else on your team owns hiring, I'd appreciate the pointer.

Thanks either way.

${signoff}`)
    }
  ];
}

export function buildKintaPersonaCampaignPayload(input: {
  persona: KintaPersonaCampaign;
  senderEmails: string[];
  startDate?: string;
}): InstantlyCampaignPayload {
  const followups = sharedFollowups(input.persona);
  const steps = [
    {
      delay: 3,
      variants: input.persona.firstEmailVariants.map((variant) => ({
        subject: variant.subject,
        body: applyLeadVariableFallbacks(variant.body),
        v_disabled: false
      }))
    },
    ...followups.map((followup, index) => ({
      delay: [4, 7, 6, 0][index],
      variants: [
        {
          subject: followup.subject,
          body: applyLeadVariableFallbacks(followup.body),
          v_disabled: false
        }
      ]
    }))
  ];

  return {
    name: input.persona.name,
    campaign_schedule: {
      schedules: [
        {
          name: "Weekday mornings EST",
          timing: { from: "07:00", to: "12:00" },
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
          timezone: "America/Detroit"
        }
      ],
      start_date: input.startDate ?? "2026-07-27"
    },
    pl_value: 100,
    is_evergreen: false,
    sequences: [
      {
        steps: steps.map((step) => ({
          type: "email" as const,
          delay: step.delay,
          delay_unit: "days" as const,
          pre_delay: 0,
          pre_delay_unit: "days" as const,
          variants: step.variants
        }))
      }
    ],
    email_gap: 15,
    random_wait_max: 15,
    text_only: false,
    first_email_text_only: true,
    email_list: input.senderEmails,
    // Five campaigns x 16 emails/day = 80/day total = 20/day per inbox.
    daily_limit: 16,
    daily_max_leads: 16,
    stop_on_reply: true,
    link_tracking: false,
    open_tracking: false,
    stop_on_auto_reply: false,
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

/**
 * Resolve the persona behind a campaign name so downstream copy can restate the
 * right offer. Without this a re-approach drafted weeks later has only the
 * prospect's autoresponder to go on, and will cheerfully pitch developers to a
 * law firm.
 */
export function findKintaPersonaByCampaignName(campaignName?: string) {
  if (!campaignName) return undefined;
  return KINTA_PERSONA_CAMPAIGNS.find((persona) => persona.name === campaignName);
}

export function getKintaPersonaCampaignSummary() {
  return KINTA_PERSONA_CAMPAIGNS.map((persona) => {
    const payload = buildKintaPersonaCampaignPayload({ persona, senderEmails: [] });
    return {
      key: persona.key,
      name: persona.name,
      persona: persona.persona,
      targetRole: persona.targetRole,
      firstEmailSubjects: persona.firstEmailVariants.map((variant) => variant.subject),
      followupSubjects: payload.sequences?.[0]?.steps.slice(1).map((step) => step.variants[0]?.subject)
    };
  });
}
