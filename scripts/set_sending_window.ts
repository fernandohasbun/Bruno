import { env } from "../src/config/env.js";

// Restores every Kinta campaign to the approved sending window after one-off tests
// (the two-day launch test leaves a Saturday-only schedule with an end_date behind).
const BASE_URL = "https://api.instantly.ai";
const START_DATE = "2026-07-27";

const SENDING_WINDOW = {
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
      // Instantly's timezone enum has no "America/New_York"; "America/Detroit" is the valid US Eastern value.
      timezone: "America/Detroit"
    }
  ],
  start_date: START_DATE,
  end_date: null
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

function scheduleSummary(campaign: Record<string, unknown>) {
  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    campaign_schedule: campaign.campaign_schedule
  };
}

function matchesWindow(campaign: Record<string, unknown>) {
  const schedule = campaign.campaign_schedule as
    | { schedules?: Array<Record<string, unknown>>; end_date?: unknown }
    | undefined;
  const first = schedule?.schedules?.[0];
  if (!first || schedule?.schedules?.length !== 1) return false;
  if (schedule.end_date) return false;
  const timing = first.timing as { from?: string; to?: string } | undefined;
  const days = first.days as Record<string, boolean> | undefined;
  return (
    timing?.from === "07:00" &&
    timing?.to === "12:00" &&
    first.timezone === "America/Detroit" &&
    days?.["0"] === false &&
    days?.["1"] === true &&
    days?.["2"] === true &&
    days?.["3"] === true &&
    days?.["4"] === true &&
    days?.["5"] === true &&
    days?.["6"] === false
  );
}

async function listKintaCampaigns() {
  const page = await instantlyRequest("/api/v2/campaigns?limit=100");
  const items = (page.items ?? []) as Array<Record<string, unknown>>;
  return items.filter((campaign) => String(campaign.name ?? "").startsWith("Kinta"));
}

async function main() {
  const apply = process.argv.slice(2).includes("--apply");
  const before = await listKintaCampaigns();
  if (before.length === 0) throw new Error("No Kinta campaigns found");

  if (!apply) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          target_window: SENDING_WINDOW,
          campaigns_before: before.map(scheduleSummary)
        },
        null,
        2
      )
    );
    return;
  }

  for (const campaign of before) {
    await instantlyRequest(`/api/v2/campaigns/${campaign.id}`, {
      method: "PATCH",
      body: JSON.stringify({ campaign_schedule: SENDING_WINDOW })
    });
  }

  const after = await Promise.all(
    before.map((campaign) => instantlyRequest(`/api/v2/campaigns/${campaign.id}`))
  );
  const unchanged = after.filter((campaign) => !matchesWindow(campaign));
  if (unchanged.length > 0) {
    throw new Error(`Sending window verification failed: ${JSON.stringify(unchanged.map(scheduleSummary))}`);
  }

  console.log(
    JSON.stringify({ mode: "applied", campaigns: after.map(scheduleSummary) }, null, 2)
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
