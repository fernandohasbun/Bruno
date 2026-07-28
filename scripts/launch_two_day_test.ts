import { env } from "../src/config/env.js";

const BASE_URL = "https://api.instantly.ai";
const TEST_START_DATE = "2026-07-24";
const TEST_END_DATE = "2026-07-25";
const PER_SENDER_DAILY_LIMIT = 20;
const PER_CAMPAIGN_DAILY_LIMIT = 16;

const SENDERS = [
  "alex@hirekinta.com",
  "daniel@hirekinta.com",
  "david@workwithkinta.com",
  "sam@workwithkinta.com"
];

const CAMPAIGNS = [
  { id: "5092939f-ce9f-4045-bb18-f99b0ab48c4f", name: "Kinta | P1 EA | B1 | 2026-07" },
  { id: "0f53c803-0bc5-4ea1-98f1-84336222f086", name: "Kinta | P2 Legal | B1 | 2026-07" },
  { id: "c03b0153-4ce6-404e-8ba1-333a5fef626d", name: "Kinta | P3 Developer | B1 | 2026-07" },
  { id: "9a945eb8-2c8b-47bd-8c8d-c66960ebf495", name: "Kinta | P4 AEC | B1 | 2026-07" },
  { id: "5df83d52-de16-49ad-9f76-6f121ed69ab0", name: "Kinta | P5 Social | B1 | 2026-07" }
];

const TEST_SCHEDULE = {
  schedules: [
    {
      name: "Friday evening test",
      timing: { from: "19:30", to: "23:59" },
      days: {
        "0": false,
        "1": false,
        "2": false,
        "3": false,
        "4": false,
        "5": true,
        "6": false
      },
      timezone: "America/Detroit"
    },
    {
      name: "Saturday morning test",
      timing: { from: "07:00", to: "11:00" },
      days: {
        "0": false,
        "1": false,
        "2": false,
        "3": false,
        "4": false,
        "5": false,
        "6": true
      },
      timezone: "America/Detroit"
    }
  ],
  start_date: TEST_START_DATE,
  end_date: TEST_END_DATE
};

async function instantlyRequest(path: string, init?: RequestInit) {
  if (!env.INSTANTLY_API_KEY) throw new Error("INSTANTLY_API_KEY is not configured");
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${env.INSTANTLY_API_KEY}`);
  if (init?.body) headers.set("content-type", "application/json");
  const response = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  if (!response.ok) {
    throw new Error(`Instantly API failed: ${response.status} ${await response.text()}`);
  }
  return response.json() as Promise<Record<string, unknown>>;
}

function accountSummary(account: Record<string, unknown>) {
  return {
    email: account.email,
    status: account.status,
    setup_pending: account.setup_pending,
    warmup_status: account.warmup_status,
    daily_limit: account.daily_limit ?? null,
    sending_gap: account.sending_gap ?? null
  };
}

function campaignSummary(campaign: Record<string, unknown>) {
  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    not_sending_status: campaign.not_sending_status ?? null,
    campaign_schedule: campaign.campaign_schedule,
    daily_limit: campaign.daily_limit,
    daily_max_leads: campaign.daily_max_leads,
    email_gap: campaign.email_gap,
    random_wait_max: campaign.random_wait_max,
    sender_count: Array.isArray(campaign.email_list) ? campaign.email_list.length : null,
    link_tracking: campaign.link_tracking,
    open_tracking: campaign.open_tracking,
    allow_risky_contacts: campaign.allow_risky_contacts,
    disable_bounce_protect: campaign.disable_bounce_protect
  };
}

async function getAccount(email: string) {
  return instantlyRequest(`/api/v2/accounts/${encodeURIComponent(email)}`);
}

async function getCampaign(id: string) {
  return instantlyRequest(`/api/v2/campaigns/${id}`);
}

async function main() {
  const apply = process.argv.slice(2).includes("--apply");
  const beforeAccounts = await Promise.all(SENDERS.map(getAccount));
  const beforeCampaigns = await Promise.all(CAMPAIGNS.map((campaign) => getCampaign(campaign.id)));

  for (const account of beforeAccounts) {
    if (account.status !== 1 || account.setup_pending || account.warmup_status !== 1) {
      throw new Error(`Sender is not ready: ${JSON.stringify(accountSummary(account))}`);
    }
  }
  for (const [index, campaign] of beforeCampaigns.entries()) {
    if (campaign.name !== CAMPAIGNS[index]?.name) {
      throw new Error(`Campaign identity mismatch for ${CAMPAIGNS[index]?.id}`);
    }
    if (campaign.status !== 2) {
      throw new Error(`Campaign must be paused before launch: ${campaign.name} status=${campaign.status}`);
    }
    if (!Array.isArray(campaign.email_list) || campaign.email_list.length !== SENDERS.length) {
      throw new Error(`Campaign sender count mismatch: ${campaign.name}`);
    }
  }

  if (!apply) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          expected_daily_total: SENDERS.length * PER_SENDER_DAILY_LIMIT,
          accounts_before: beforeAccounts.map(accountSummary),
          campaigns_before: beforeCampaigns.map(campaignSummary),
          proposed_schedule: TEST_SCHEDULE
        },
        null,
        2
      )
    );
    return;
  }

  for (const email of SENDERS) {
    await instantlyRequest(`/api/v2/accounts/${encodeURIComponent(email)}`, {
      method: "PATCH",
      body: JSON.stringify({
        daily_limit: PER_SENDER_DAILY_LIMIT,
        sending_gap: 10
      })
    });
  }

  for (const campaign of CAMPAIGNS) {
    await instantlyRequest(`/api/v2/campaigns/${campaign.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        campaign_schedule: TEST_SCHEDULE,
        daily_limit: PER_CAMPAIGN_DAILY_LIMIT,
        daily_max_leads: PER_CAMPAIGN_DAILY_LIMIT,
        email_gap: 10,
        random_wait_max: 5
      })
    });
  }

  const activatedIds: string[] = [];
  try {
    for (const campaign of CAMPAIGNS) {
      await instantlyRequest(`/api/v2/campaigns/${campaign.id}/activate`, { method: "POST" });
      activatedIds.push(campaign.id);
    }
  } catch (error) {
    await Promise.allSettled(
      activatedIds.map((id) => instantlyRequest(`/api/v2/campaigns/${id}/pause`, { method: "POST" }))
    );
    throw error;
  }

  const afterAccounts = await Promise.all(SENDERS.map(getAccount));
  const afterCampaigns = await Promise.all(CAMPAIGNS.map((campaign) => getCampaign(campaign.id)));
  for (const account of afterAccounts) {
    if (account.daily_limit !== PER_SENDER_DAILY_LIMIT || account.sending_gap !== 10) {
      throw new Error(`Sender limit verification failed: ${JSON.stringify(accountSummary(account))}`);
    }
  }
  for (const campaign of afterCampaigns) {
    if (
      campaign.status !== 1 ||
      campaign.daily_limit !== PER_CAMPAIGN_DAILY_LIMIT ||
      campaign.daily_max_leads !== PER_CAMPAIGN_DAILY_LIMIT
    ) {
      throw new Error(`Campaign verification failed: ${JSON.stringify(campaignSummary(campaign))}`);
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: "applied",
        expected_daily_total: SENDERS.length * PER_SENDER_DAILY_LIMIT,
        total_across_two_days: SENDERS.length * PER_SENDER_DAILY_LIMIT * 2,
        accounts: afterAccounts.map(accountSummary),
        campaigns: afterCampaigns.map(campaignSummary)
      },
      null,
      2
    )
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
