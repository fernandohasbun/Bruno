import {
  completeSync,
  failSync,
  getLocalCampaignCounts,
  getSyncCheckpoint,
  pruneCrmLeadsOlderThan,
  recordReconciliation,
  saveCampaignSnapshot,
  startSync,
  upsertCrmLeads,
  upsertCrmMessages
} from "../db/crm.js";
import { activateAlertOnce, clearAlertOnce } from "../db/config.js";
import { pool } from "../db/pool.js";
import {
  countCampaignLeads,
  getCampaignAnalyticsOverview,
  getInstantlyCampaign,
  listInstantlyCampaigns,
  listInstantlyEmailsPage,
  listInstantlyLeadsPage
} from "../integrations/instantly.js";
import { notifyAlert } from "../integrations/notify.js";
import type { QueueJob } from "../queue/queue.js";

const LEADS_STREAM = "crm.leads.full";
const MESSAGES_STREAM = "crm.messages.incremental";

async function withSyncLock<T>(name: string, run: () => Promise<T>): Promise<T | undefined> {
  const client = await pool.connect();
  try {
    const lock = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
      [`bruno:${name}`]
    );
    if (!lock.rows[0]?.acquired) return undefined;
    try {
      return await run();
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [`bruno:${name}`]);
    }
  } finally {
    client.release();
  }
}

export async function processCrmLeadSyncJob(_job: QueueJob) {
  return withSyncLock(LEADS_STREAM, async () => {
  const startedAt = new Date();
  await startSync(LEADS_STREAM);
  let records = 0;
  let cursor: string | undefined;
  let pages = 0;

  try {
    do {
      const page = await listInstantlyLeadsPage({
        limit: 100,
        startingAfter: cursor,
        distinctContacts: false
      });
      records += await upsertCrmLeads(page.leads, startedAt);
      cursor = page.nextStartingAfter;
      pages += 1;
      if (cursor && pages >= 100) throw new Error("Lead synchronization exceeded the 10,000-record safety boundary");
    } while (cursor);

    await pruneCrmLeadsOlderThan(startedAt);
    await completeSync({
      stream: LEADS_STREAM,
      records,
      watermark: startedAt.toISOString()
    });
  } catch (error) {
    await failSync(LEADS_STREAM, error);
    throw error;
  }
  });
}

export async function processCrmMessageSyncJob(_job: QueueJob) {
  return withSyncLock(MESSAGES_STREAM, async () => {
  await startSync(MESSAGES_STREAM);
  const checkpoint = await getSyncCheckpoint(MESSAGES_STREAM);
  const overlapStart = checkpoint?.watermark
    ? new Date(new Date(checkpoint.watermark).getTime() - 10 * 60 * 1000).toISOString()
    : "2020-01-01T00:00:00.000Z";
  let cursor = checkpoint?.cursor ?? undefined;
  let records = 0;
  let pages = 0;
  let latestTimestamp = checkpoint?.watermark ?? overlapStart;

  try {
    do {
      const page = await listInstantlyEmailsPage({
        limit: 100,
        startingAfter: cursor,
        minTimestampCreated: overlapStart,
        sortOrder: "asc"
      });
      records += await upsertCrmMessages(page.messages);
      for (const message of page.messages) {
        const timestamp = message.timestampCreated ?? message.timestampEmail;
        if (timestamp && timestamp > latestTimestamp) latestTimestamp = timestamp;
      }
      cursor = page.nextStartingAfter;
      pages += 1;
    } while (cursor && pages < 15);

    await completeSync({
      stream: MESSAGES_STREAM,
      records,
      cursor,
      // Keep the original query boundary while a large backfill still has a
      // cursor. Once exhausted, advance to the newest observed message.
      watermark: cursor ? overlapStart : latestTimestamp
    });
  } catch (error) {
    await failSync(MESSAGES_STREAM, error);
    throw error;
  }
  });
}

export async function processCrmReconcileJob(_job: QueueJob) {
  return withSyncLock("crm.reconcile", async () => {
  const campaigns = await listInstantlyCampaigns({ limit: 100 });

  for (const campaign of campaigns) {
    const [detail, analytics, providerLeadCount, local] = await Promise.all([
      getInstantlyCampaign(campaign.id),
      getCampaignAnalyticsOverview(campaign.id),
      countCampaignLeads({ campaignId: campaign.id, maxPages: 100 }),
      getLocalCampaignCounts(campaign.id)
    ]);
    await saveCampaignSnapshot(detail, "reconciliation");

    const leadsMatch = !providerLeadCount.capped && providerLeadCount.count === local.leads;
    const sentMatch = analytics.emails_sent_count === local.sent;
    const matches = leadsMatch && sentMatch;
    await recordReconciliation({
      scope: `campaign:${campaign.id}`,
      providerLeads: providerLeadCount.count,
      localLeads: local.leads,
      providerSent: analytics.emails_sent_count,
      localSent: local.sent,
      matches,
      details: {
        campaign_name: campaign.name,
        lead_count_capped: providerLeadCount.capped,
        leads_match: leadsMatch,
        sent_match: sentMatch
      }
    });

    const alertKey = `crm-reconciliation:${campaign.id}`;
    if (!matches) {
      if (await activateAlertOnce(alertKey, {
        providerLeads: providerLeadCount.count,
        localLeads: local.leads,
        providerSent: analytics.emails_sent_count,
        localSent: local.sent
      })) {
        await notifyAlert(
          `CRM reconciliation differs for ${campaign.name}: leads Instantly ${providerLeadCount.count} vs Bruno ${local.leads}; sent Instantly ${analytics.emails_sent_count} vs Bruno ${local.sent}. Synchronization will retry before any data is treated as complete.`
        );
      }
    } else {
      await clearAlertOnce(alertKey);
    }
  }
  });
}
