import { pool } from "./pool.js";
import type {
  InstantlyCampaignDetail,
  InstantlyEmailRecord,
  InstantlyLeadRecord
} from "../integrations/instantly.js";

export interface CrmLeadPageInput {
  page?: number;
  pageSize?: number;
  search?: string;
  campaignId?: string;
  status?: number;
  interestStatus?: number;
  persona?: string;
  view?: CrmLeadView;
}

/**
 * Roster views, in funnel order. "contacted" exists because "in-sequence" is not
 * it: Instantly marks every imported lead status 1, so that view returned the
 * whole import list — 499 rows on P2 Legal, of which 23 had actually been
 * emailed. last_contact_at is only set once a send happens.
 */
export const CRM_LEAD_VIEWS = [
  "all",
  "contacted",
  "no-reply",
  "away",
  "needs-read",
  "replied",
  "interested",
  "in-sequence",
  "finished",
  "suppressed"
] as const;

export type CrmLeadView = (typeof CRM_LEAD_VIEWS)[number];

export interface CrmLeadRow {
  provider_lead_id: string;
  email: string;
  campaign_id: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  job_title: string | null;
  status: number | null;
  interest_status: number | null;
  email_open_count: number;
  email_click_count: number;
  email_reply_count: number;
  last_contact_at: string | null;
  custom_fields: Record<string, string>;
  synced_at: string;
  /** Bruno's most recent read of this lead — null until they reply at all. */
  bruno_intent: string | null;
  bruno_return_date: Date | null;
  bruno_reason: string | null;
  bruno_at: string | null;
}

export interface CrmMessagePageInput {
  page?: number;
  pageSize?: number;
  search?: string;
  campaignId?: string;
  leadEmail?: string;
  eaccount?: string;
  direction?: "sent" | "received" | "manual";
  from?: string;
  to?: string;
  intent?: string;
}

export interface CrmMessageRow {
  provider_email_id: string;
  message_id: string | null;
  thread_id: string | null;
  provider_lead_id: string | null;
  lead_email: string | null;
  campaign_id: string | null;
  eaccount: string | null;
  direction: "sent" | "received" | "manual";
  step: string | null;
  variant: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  content_preview: string | null;
  provider_created_at: string | null;
  timestamp_email: string | null;
  synced_at: string;
  /** Bruno's verdict on this exact message — null on anything he never read. */
  bruno_intent: string | null;
  bruno_reason: string | null;
  bruno_confidence: number | null;
  bruno_return_date: Date | null;
}

function isoOrNull(value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function cleanCustomFields(value: Record<string, string>) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => typeof item === "string"));
}

/** Bulk-upsert one provider page of leads through jsonb_to_recordset. */
export async function upsertCrmLeads(leads: InstantlyLeadRecord[], syncedAt = new Date()) {
  const rows = leads.flatMap((lead) => {
    if (!lead.id || !lead.email) return [];
    return [{
      provider_lead_id: lead.id,
      email: lead.email,
      campaign_id: lead.campaignId ?? null,
      list_id: lead.listId ?? null,
      first_name: lead.firstName ?? null,
      last_name: lead.lastName ?? null,
      company_name: lead.companyName ?? null,
      company_domain: lead.companyDomain ?? null,
      job_title: lead.jobTitle ?? null,
      status: lead.status ?? null,
      interest_status: lead.interestStatus ?? null,
      verification_status: lead.verificationStatus ?? null,
      email_open_count: lead.openCount,
      email_click_count: lead.clickCount,
      email_reply_count: lead.replyCount,
      last_contact_at: isoOrNull(lead.lastContactAt),
      last_open_at: isoOrNull(lead.lastOpenAt),
      last_click_at: isoOrNull(lead.lastClickAt),
      last_reply_at: isoOrNull(lead.lastReplyAt),
      custom_fields: cleanCustomFields(lead.customFields),
      raw: lead.raw ?? {},
      provider_created_at: isoOrNull(lead.createdAt),
      provider_updated_at: isoOrNull(lead.updatedAt),
      synced_at: syncedAt.toISOString()
    }];
  });
  if (rows.length === 0) return 0;

  await pool.query(
    `
      INSERT INTO crm_leads (
        provider_lead_id, email, campaign_id, list_id, first_name, last_name,
        company_name, company_domain, job_title, status, interest_status,
        verification_status, email_open_count, email_click_count, email_reply_count,
        last_contact_at, last_open_at, last_click_at, last_reply_at,
        custom_fields, raw, provider_created_at, provider_updated_at, synced_at
      )
      SELECT
        provider_lead_id, email, campaign_id, list_id, first_name, last_name,
        company_name, company_domain, job_title, status, interest_status,
        verification_status, email_open_count, email_click_count, email_reply_count,
        last_contact_at, last_open_at, last_click_at, last_reply_at,
        custom_fields, raw, provider_created_at, provider_updated_at, synced_at
      FROM jsonb_to_recordset($1::jsonb) AS x(
        provider_lead_id text, email text, campaign_id text, list_id text,
        first_name text, last_name text, company_name text, company_domain text,
        job_title text, status integer, interest_status integer,
        verification_status integer, email_open_count integer,
        email_click_count integer, email_reply_count integer,
        last_contact_at timestamptz, last_open_at timestamptz,
        last_click_at timestamptz, last_reply_at timestamptz,
        custom_fields jsonb, raw jsonb, provider_created_at timestamptz,
        provider_updated_at timestamptz, synced_at timestamptz
      )
      ON CONFLICT (provider_lead_id) DO UPDATE SET
        email = EXCLUDED.email,
        campaign_id = EXCLUDED.campaign_id,
        list_id = EXCLUDED.list_id,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        company_name = EXCLUDED.company_name,
        company_domain = EXCLUDED.company_domain,
        job_title = EXCLUDED.job_title,
        status = EXCLUDED.status,
        interest_status = EXCLUDED.interest_status,
        verification_status = EXCLUDED.verification_status,
        email_open_count = EXCLUDED.email_open_count,
        email_click_count = EXCLUDED.email_click_count,
        email_reply_count = EXCLUDED.email_reply_count,
        last_contact_at = EXCLUDED.last_contact_at,
        last_open_at = EXCLUDED.last_open_at,
        last_click_at = EXCLUDED.last_click_at,
        last_reply_at = EXCLUDED.last_reply_at,
        custom_fields = EXCLUDED.custom_fields,
        raw = EXCLUDED.raw,
        provider_created_at = EXCLUDED.provider_created_at,
        provider_updated_at = EXCLUDED.provider_updated_at,
        synced_at = EXCLUDED.synced_at
    `,
    [JSON.stringify(rows)]
  );
  return rows.length;
}

/** Remove stale rows only after a complete successful workspace scan. */
export async function pruneCrmLeadsOlderThan(fullSyncStartedAt: Date) {
  const result = await pool.query("DELETE FROM crm_leads WHERE synced_at < $1", [fullSyncStartedAt]);
  return result.rowCount ?? 0;
}

/** Bulk-upsert one provider page of exact rendered messages. */
export async function upsertCrmMessages(messages: InstantlyEmailRecord[], syncedAt = new Date()) {
  const rows = messages.flatMap((message) => {
    if (!message.id) return [];
    const raw = (message.raw ?? {}) as Record<string, unknown>;
    return [{
      provider_email_id: message.id,
      message_id: message.messageId ?? null,
      thread_id: message.threadId ?? null,
      provider_lead_id: message.leadId ?? null,
      lead_email: message.leadEmail ?? null,
      campaign_id: message.campaignId ?? null,
      list_id: message.listId ?? null,
      eaccount: message.eaccount ?? null,
      direction: message.direction,
      step: message.step ?? null,
      variant: message.variant ?? null,
      subject: message.subject ?? null,
      body_text: message.bodyText ?? message.threadText ?? null,
      body_html: message.bodyHtml ?? null,
      content_preview: message.preview ?? null,
      is_unread: message.isUnread ?? null,
      is_auto_reply: message.isAutoReply ?? null,
      is_focused: message.isFocused ?? null,
      email_status: message.emailStatus ?? null,
      provider_created_at: isoOrNull(message.timestampCreated),
      timestamp_email: isoOrNull(message.timestampEmail),
      raw,
      synced_at: syncedAt.toISOString()
    }];
  });
  if (rows.length === 0) return 0;

  await pool.query(
    `
      INSERT INTO crm_messages (
        provider_email_id, message_id, thread_id, provider_lead_id, lead_email,
        campaign_id, list_id, eaccount, direction, step, variant, subject,
        body_text, body_html, content_preview, is_unread, is_auto_reply,
        is_focused, email_status, provider_created_at, timestamp_email, raw, synced_at
      )
      SELECT
        provider_email_id, message_id, thread_id, provider_lead_id, lead_email,
        campaign_id, list_id, eaccount, direction, step, variant, subject,
        body_text, body_html, content_preview, is_unread, is_auto_reply,
        is_focused, email_status, provider_created_at, timestamp_email, raw, synced_at
      FROM jsonb_to_recordset($1::jsonb) AS x(
        provider_email_id text, message_id text, thread_id text,
        provider_lead_id text, lead_email text, campaign_id text, list_id text,
        eaccount text, direction text, step text, variant text, subject text,
        body_text text, body_html text, content_preview text, is_unread boolean,
        is_auto_reply boolean, is_focused boolean, email_status integer,
        provider_created_at timestamptz, timestamp_email timestamptz,
        raw jsonb, synced_at timestamptz
      )
      ON CONFLICT (provider_email_id) DO UPDATE SET
        message_id = EXCLUDED.message_id,
        thread_id = EXCLUDED.thread_id,
        provider_lead_id = EXCLUDED.provider_lead_id,
        lead_email = EXCLUDED.lead_email,
        campaign_id = EXCLUDED.campaign_id,
        list_id = EXCLUDED.list_id,
        eaccount = EXCLUDED.eaccount,
        direction = EXCLUDED.direction,
        step = EXCLUDED.step,
        variant = EXCLUDED.variant,
        subject = EXCLUDED.subject,
        body_text = EXCLUDED.body_text,
        body_html = EXCLUDED.body_html,
        content_preview = EXCLUDED.content_preview,
        is_unread = EXCLUDED.is_unread,
        is_auto_reply = EXCLUDED.is_auto_reply,
        is_focused = EXCLUDED.is_focused,
        email_status = EXCLUDED.email_status,
        provider_created_at = EXCLUDED.provider_created_at,
        timestamp_email = EXCLUDED.timestamp_email,
        raw = EXCLUDED.raw,
        synced_at = EXCLUDED.synced_at
    `,
    [JSON.stringify(rows)]
  );
  return rows.length;
}

export async function listCrmLeadsPage(input: CrmLeadPageInput = {}) {
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.min(100, Math.max(10, Math.floor(input.pageSize ?? 50)));
  const search = input.search?.trim() || null;
  const result = await pool.query<CrmLeadRow & { total_count: string }>(
    `
      SELECT l.*,
             bruno.intent          AS bruno_intent,
             bruno.ooo_return_date AS bruno_return_date,
             bruno.reason          AS bruno_reason,
             bruno.created_at::text AS bruno_at,
             count(*) OVER()::text AS total_count
      FROM crm_leads l
      -- Bruno's latest read travels with the lead, so the roster shows what he
      -- concluded next to what the provider reports. Same join the lead dossier
      -- already does in getLeadActivity; both tables key on lower(email).
      LEFT JOIN LATERAL (
        SELECT rc.intent, rc.ooo_return_date, rc.reason, rc.created_at
        FROM reply_classifications rc
        WHERE lower(rc.email) = lower(l.email)
        ORDER BY rc.created_at DESC
        LIMIT 1
      ) bruno ON true
      WHERE ($1::text IS NULL OR
        l.email ILIKE '%' || $1 || '%' OR
        coalesce(l.first_name, '') ILIKE '%' || $1 || '%' OR
        coalesce(l.last_name, '') ILIKE '%' || $1 || '%' OR
        coalesce(l.company_name, '') ILIKE '%' || $1 || '%' OR
        coalesce(l.job_title, '') ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR l.campaign_id = $2)
        AND ($3::integer IS NULL OR l.status = $3)
        AND ($4::integer IS NULL OR l.interest_status = $4)
        AND ($5::text IS NULL OR l.custom_fields->>'persona' = $5)
        AND (
          $6::text IS NULL OR $6 = 'all'
          OR ($6 = 'contacted' AND l.last_contact_at IS NOT NULL)
          OR ($6 = 'no-reply' AND l.last_contact_at IS NOT NULL AND l.email_reply_count = 0)
          OR ($6 = 'away' AND bruno.intent = 'out_of_office')
          OR ($6 = 'needs-read' AND bruno.intent = 'unclear')
          OR ($6 = 'replied' AND l.email_reply_count > 0)
          OR ($6 = 'interested' AND l.interest_status >= 1)
          OR ($6 = 'in-sequence' AND l.status IN (1, 2))
          OR ($6 = 'finished' AND l.status = 3)
          OR ($6 = 'suppressed' AND l.status < 0)
        )
      ORDER BY coalesce(l.last_contact_at, l.provider_created_at, l.synced_at) DESC, l.email ASC
      LIMIT $7 OFFSET $8
    `,
    [
      search,
      input.campaignId ?? null,
      input.status ?? null,
      input.interestStatus ?? null,
      input.persona ?? null,
      input.view ?? null,
      pageSize,
      (page - 1) * pageSize
    ]
  );
  return {
    leads: result.rows.map(({ total_count: _total, ...row }) => row),
    total: Number(result.rows[0]?.total_count ?? 0),
    page,
    pageSize
  };
}

export async function getCrmSummary() {
  const [totals, campaigns, personas] = await Promise.all([
    pool.query<{
      total: string;
      uncontacted: string;
      contacted: string;
      no_reply: string;
      away: string;
      needs_read: string;
      in_sequence: string;
      finished: string;
      suppressed: string;
      replied: string;
      interested: string;
      meetings: string;
    }>(
      `
        WITH latest AS (
          SELECT DISTINCT ON (lower(email)) lower(email) AS email, intent
          FROM reply_classifications
          WHERE email IS NOT NULL
          ORDER BY lower(email), created_at DESC
        )
        SELECT
          count(*)::text AS total,
          count(*) FILTER (WHERE l.last_contact_at IS NULL)::text AS uncontacted,
          count(*) FILTER (WHERE l.last_contact_at IS NOT NULL)::text AS contacted,
          count(*) FILTER (WHERE l.last_contact_at IS NOT NULL AND l.email_reply_count = 0)::text AS no_reply,
          count(*) FILTER (WHERE b.intent = 'out_of_office')::text AS away,
          count(*) FILTER (WHERE b.intent = 'unclear')::text AS needs_read,
          count(*) FILTER (WHERE l.status IN (1, 2))::text AS in_sequence,
          count(*) FILTER (WHERE l.status = 3)::text AS finished,
          count(*) FILTER (WHERE l.status < 0)::text AS suppressed,
          count(*) FILTER (WHERE l.email_reply_count > 0)::text AS replied,
          count(*) FILTER (WHERE l.interest_status >= 1)::text AS interested,
          count(*) FILTER (WHERE l.interest_status IN (2, 3, 4))::text AS meetings
        FROM crm_leads l
        LEFT JOIN latest b ON b.email = lower(l.email)
      `
    ),
    pool.query<{ campaign_id: string | null; total: string; contacted: string; replied: string }>(
      `
        SELECT campaign_id, count(*)::text AS total,
               count(*) FILTER (WHERE last_contact_at IS NOT NULL)::text AS contacted,
               count(*) FILTER (WHERE email_reply_count > 0)::text AS replied
        FROM crm_leads GROUP BY campaign_id ORDER BY count(*) DESC
      `
    ),
    pool.query<{ persona: string; total: string; contacted: string; replied: string }>(
      `
        SELECT coalesce(custom_fields->>'persona', 'Unassigned') AS persona,
               count(*)::text AS total,
               count(*) FILTER (WHERE last_contact_at IS NOT NULL)::text AS contacted,
               count(*) FILTER (WHERE email_reply_count > 0)::text AS replied
        FROM crm_leads GROUP BY 1 ORDER BY count(*) DESC
      `
    )
  ]);
  const row = totals.rows[0] ?? {
    total: "0", uncontacted: "0", contacted: "0", no_reply: "0", away: "0",
    needs_read: "0", in_sequence: "0", finished: "0",
    suppressed: "0", replied: "0", interested: "0", meetings: "0"
  };
  return {
    total: Number(row.total),
    uncontacted: Number(row.uncontacted),
    contacted: Number(row.contacted),
    noReply: Number(row.no_reply),
    away: Number(row.away),
    needsRead: Number(row.needs_read),
    inSequence: Number(row.in_sequence),
    finished: Number(row.finished),
    suppressed: Number(row.suppressed),
    replied: Number(row.replied),
    interested: Number(row.interested),
    meetings: Number(row.meetings),
    campaigns: campaigns.rows.map((item) => ({
      campaignId: item.campaign_id,
      total: Number(item.total),
      contacted: Number(item.contacted),
      replied: Number(item.replied)
    })),
    personas: personas.rows.map((item) => ({
      persona: item.persona,
      total: Number(item.total),
      contacted: Number(item.contacted),
      replied: Number(item.replied)
    }))
  };
}

export async function listCrmMessagesPage(input: CrmMessagePageInput = {}) {
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.min(100, Math.max(10, Math.floor(input.pageSize ?? 50)));
  const search = input.search?.trim() || null;
  const result = await pool.query<CrmMessageRow & { total_count: string }>(
    `
      SELECT m.*,
             bruno.intent           AS bruno_intent,
             bruno.reason           AS bruno_reason,
             bruno.confidence::float AS bruno_confidence,
             bruno.ooo_return_date  AS bruno_return_date,
             count(*) OVER()::text  AS total_count
      FROM crm_messages m
      -- Exact, not fuzzy. reply.poll stores the Instantly email id as the event's
      -- provider_event_id, and crm_messages keys on that same id — so a message
      -- resolves the one classification it produced, even for a lead who replied
      -- several times. Indexed by events' UNIQUE (provider, provider_event_id).
      LEFT JOIN LATERAL (
        SELECT rc.intent, rc.reason, rc.confidence, rc.ooo_return_date
        FROM events e
        JOIN reply_classifications rc ON rc.event_id = e.id
        WHERE e.provider = 'instantly' AND e.provider_event_id = m.provider_email_id
        ORDER BY rc.created_at DESC
        LIMIT 1
      ) bruno ON true
      WHERE ($1::text IS NULL OR
        coalesce(m.lead_email, '') ILIKE '%' || $1 || '%' OR
        coalesce(m.subject, '') ILIKE '%' || $1 || '%' OR
        coalesce(m.body_text, '') ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR m.campaign_id = $2)
        AND ($3::text IS NULL OR lower(m.lead_email) = lower($3))
        AND ($4::text IS NULL OR m.eaccount = $4)
        AND ($5::text IS NULL OR m.direction = $5)
        AND ($6::timestamptz IS NULL OR coalesce(m.timestamp_email, m.provider_created_at) >= $6)
        AND ($7::timestamptz IS NULL OR coalesce(m.timestamp_email, m.provider_created_at) <= $7)
        AND ($8::text IS NULL OR bruno.intent = $8)
      ORDER BY coalesce(m.timestamp_email, m.provider_created_at) DESC, m.provider_email_id DESC
      LIMIT $9 OFFSET $10
    `,
    [
      search,
      input.campaignId ?? null,
      input.leadEmail ?? null,
      input.eaccount ?? null,
      input.direction ?? null,
      input.from ? isoOrNull(input.from) : null,
      input.to ? isoOrNull(input.to) : null,
      input.intent ?? null,
      pageSize,
      (page - 1) * pageSize
    ]
  );
  return {
    messages: result.rows.map(({ total_count: _total, ...row }) => row),
    total: Number(result.rows[0]?.total_count ?? 0),
    page,
    pageSize
  };
}

/**
 * The current lead cohort's earliest creation timestamp — a fixed point-zero
 * marking the last full lead-list purge/reload, not a rolling "N days ago"
 * window that would silently start hiding real recent data again once it
 * ages past that many days. Every lead older than this was hard-deleted;
 * anything still in crm_leads today was (re)created at or after this moment.
 */
export async function getLeadCohortStartDate(): Promise<string | undefined> {
  const result = await pool.query<{ earliest: Date | null }>(
    "SELECT min(provider_created_at) AS earliest FROM crm_leads"
  );
  return result.rows[0]?.earliest ? result.rows[0].earliest.toISOString() : undefined;
}

/**
 * Sends today, from our own message mirror rather than Instantly's lifetime
 * campaign counter. The Instantly "sent" figure never resets and accumulates
 * across every lead-list reload since the campaign was created, which makes
 * it useless for "how many went out today" — this answers that directly.
 */
export async function getSentToday(timezone = "America/Detroit") {
  const result = await pool.query<{ campaign_id: string | null; sent: string }>(
    `
      SELECT campaign_id, count(*)::text AS sent
      FROM crm_messages
      WHERE direction = 'sent'
        AND (timestamp_email AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date
      GROUP BY campaign_id
    `,
    [timezone]
  );
  return {
    total: result.rows.reduce((sum, row) => sum + Number(row.sent), 0),
    byCampaign: result.rows.map((row) => ({ campaignId: row.campaign_id, sent: Number(row.sent) }))
  };
}

export async function getCrmMessageSummary(since?: string) {
  const [totals, senders, intents] = await Promise.all([
    pool.query<{ total: string; sent: string; received: string; manual: string; leads: string }>(
      `
        SELECT
          count(*)::text AS total,
          count(*) FILTER (WHERE direction = 'sent')::text AS sent,
          count(*) FILTER (WHERE direction = 'received')::text AS received,
          count(*) FILTER (WHERE direction = 'manual')::text AS manual,
          count(DISTINCT lower(lead_email)) FILTER (WHERE lead_email IS NOT NULL)::text AS leads
        FROM crm_messages
        WHERE ($1::timestamptz IS NULL OR coalesce(timestamp_email, provider_created_at) >= $1)
      `,
      [since ?? null]
    ),
    pool.query<{ eaccount: string; count: string }>(
      `
        SELECT eaccount, count(*)::text AS count
        FROM crm_messages
        WHERE eaccount IS NOT NULL
          AND ($1::timestamptz IS NULL OR coalesce(timestamp_email, provider_created_at) >= $1)
        GROUP BY eaccount
        ORDER BY count(*) DESC, eaccount
      `,
      [since ?? null]
    ),
    // Only intents actually present get offered as filters — a dropdown listing
    // every possible intent mostly promises empty result sets.
    pool.query<{ intent: string; count: string }>(
      `
        SELECT rc.intent, count(*)::text AS count
        FROM crm_messages m
        JOIN events e
          ON e.provider = 'instantly' AND e.provider_event_id = m.provider_email_id
        JOIN reply_classifications rc ON rc.event_id = e.id
        WHERE ($1::timestamptz IS NULL OR coalesce(m.timestamp_email, m.provider_created_at) >= $1)
        GROUP BY rc.intent
        ORDER BY count(*) DESC, rc.intent
      `,
      [since ?? null]
    )
  ]);
  const row = totals.rows[0] ?? { total: "0", sent: "0", received: "0", manual: "0", leads: "0" };
  return {
    total: Number(row.total),
    sent: Number(row.sent),
    received: Number(row.received),
    manual: Number(row.manual),
    leads: Number(row.leads),
    senders: senders.rows.map((item) => ({ email: item.eaccount, messages: Number(item.count) })),
    intents: intents.rows.map((item) => ({ intent: item.intent, messages: Number(item.count) }))
  };
}

export async function getCrmLeadByEmail(email: string) {
  const result = await pool.query<CrmLeadRow>(
    "SELECT * FROM crm_leads WHERE lower(email) = lower($1) ORDER BY synced_at DESC LIMIT 1",
    [email]
  );
  return result.rows[0];
}

export async function listCrmLeadMessages(email: string, limit = 500) {
  const result = await pool.query<CrmMessageRow>(
    `
      SELECT * FROM crm_messages
      WHERE lower(lead_email) = lower($1)
      ORDER BY coalesce(timestamp_email, provider_created_at) ASC
      LIMIT $2
    `,
    [email, Math.min(1000, Math.max(1, limit))]
  );
  return result.rows;
}

export interface SyncCheckpoint {
  stream: string;
  cursor: string | null;
  watermark: string | null;
  status: "idle" | "running" | "ok" | "error";
  records_synced: number;
  last_started_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
}

export async function getSyncCheckpoint(stream: string) {
  const result = await pool.query<SyncCheckpoint>("SELECT * FROM sync_checkpoints WHERE stream = $1", [stream]);
  return result.rows[0];
}

export async function startSync(stream: string) {
  await pool.query(
    `
      INSERT INTO sync_checkpoints (stream, status, last_started_at, updated_at)
      VALUES ($1, 'running', now(), now())
      ON CONFLICT (stream) DO UPDATE
      SET status = 'running', last_started_at = now(), last_error = NULL, updated_at = now()
    `,
    [stream]
  );
}

export async function completeSync(input: { stream: string; cursor?: string; watermark?: string; records: number }) {
  await pool.query(
    `
      INSERT INTO sync_checkpoints (
        stream, cursor, watermark, status, records_synced, last_started_at,
        last_success_at, last_error, updated_at
      )
      VALUES ($1, $2, $3, 'ok', $4, now(), now(), NULL, now())
      ON CONFLICT (stream) DO UPDATE
      SET cursor = EXCLUDED.cursor,
          watermark = EXCLUDED.watermark,
          status = 'ok',
          records_synced = sync_checkpoints.records_synced + EXCLUDED.records_synced,
          last_success_at = now(),
          last_error = NULL,
          updated_at = now()
    `,
    [input.stream, input.cursor ?? null, input.watermark ?? null, input.records]
  );
}

export async function failSync(stream: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await pool.query(
    `
      INSERT INTO sync_checkpoints (stream, status, last_started_at, last_error, updated_at)
      VALUES ($1, 'error', now(), $2, now())
      ON CONFLICT (stream) DO UPDATE
      SET status = 'error', last_error = EXCLUDED.last_error, updated_at = now()
    `,
    [stream, message.slice(0, 4000)]
  );
}

export async function listSyncCheckpoints() {
  const result = await pool.query<SyncCheckpoint>("SELECT * FROM sync_checkpoints ORDER BY stream");
  return result.rows;
}

export async function saveCampaignSnapshot(campaign: InstantlyCampaignDetail, reason = "sync") {
  const snapshot = JSON.stringify(campaign);
  await pool.query(
    `
      INSERT INTO campaign_snapshots (campaign_id, campaign_name, content_hash, snapshot, reason)
      VALUES ($1, $2, encode(digest($3, 'sha256'), 'hex'), $3::jsonb, $4)
      ON CONFLICT (campaign_id, content_hash) DO NOTHING
    `,
    [campaign.id, campaign.name, snapshot, reason]
  );
}

export async function recordReconciliation(input: {
  scope: string;
  providerLeads?: number;
  localLeads?: number;
  providerSent?: number;
  localSent?: number;
  matches: boolean;
  details?: unknown;
}) {
  await pool.query(
    `
      INSERT INTO reconciliation_runs (
        scope, provider_leads, local_leads, provider_sent, local_sent, matches, details
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    `,
    [
      input.scope,
      input.providerLeads ?? null,
      input.localLeads ?? null,
      input.providerSent ?? null,
      input.localSent ?? null,
      input.matches,
      JSON.stringify(input.details ?? {})
    ]
  );
}

/**
 * Drop reconciliation history for any scope not in the current live campaign
 * list. A deleted campaign never gets rechecked again — without this its
 * last recorded state (often a stale "mismatch" from before it was cleaned
 * up) sits in reconciliation_runs forever, misreported as an ongoing problem.
 */
export async function pruneReconciliationExcept(liveScopes: string[]) {
  await pool.query(
    `DELETE FROM reconciliation_runs WHERE scope LIKE 'campaign:%' AND NOT (scope = ANY($1::text[]))`,
    [liveScopes]
  );
}

export async function getLatestReconciliation() {
  const result = await pool.query<{
    scope: string;
    provider_leads: number | null;
    local_leads: number | null;
    provider_sent: number | null;
    local_sent: number | null;
    matches: boolean;
    details: unknown;
    reconciled_at: string;
  }>(
    `
      SELECT DISTINCT ON (scope) scope, provider_leads, local_leads,
             provider_sent, local_sent, matches, details, reconciled_at::text
      FROM reconciliation_runs
      ORDER BY scope, reconciled_at DESC
    `
  );
  return result.rows;
}

export async function getLocalCampaignCounts(campaignId: string) {
  const result = await pool.query<{ leads: string; sent: string }>(
    `
      SELECT
        (SELECT count(*)::text FROM crm_leads WHERE campaign_id = $1) AS leads,
        (SELECT count(*)::text FROM crm_messages WHERE campaign_id = $1 AND direction = 'sent') AS sent
    `,
    [campaignId]
  );
  return {
    leads: Number(result.rows[0]?.leads ?? 0),
    sent: Number(result.rows[0]?.sent ?? 0)
  };
}

export async function recordAgentAction(input: {
  action: string;
  targetType: string;
  targetId?: string;
  actor?: string;
  reason?: string;
  beforeState?: unknown;
  afterState?: unknown;
  providerResponse?: unknown;
  status?: "proposed" | "completed" | "failed";
}) {
  await pool.query(
    `
      INSERT INTO agent_action_logs (
        action, target_type, target_id, actor, reason,
        before_state, after_state, provider_response, status
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9)
    `,
    [
      input.action,
      input.targetType,
      input.targetId ?? null,
      input.actor ?? "dashboard",
      input.reason ?? null,
      input.beforeState === undefined ? null : JSON.stringify(input.beforeState),
      input.afterState === undefined ? null : JSON.stringify(input.afterState),
      input.providerResponse === undefined ? null : JSON.stringify(input.providerResponse),
      input.status ?? "completed"
    ]
  );
}

export async function listRecentAgentActions(limit = 50) {
  const result = await pool.query<{
    action: string;
    target_type: string;
    target_id: string | null;
    actor: string;
    reason: string | null;
    status: string;
    created_at: string;
  }>(
    `
      SELECT action, target_type, target_id, actor, reason, status, created_at::text
      FROM agent_action_logs ORDER BY created_at DESC LIMIT $1
    `,
    [Math.min(100, Math.max(1, limit))]
  );
  return result.rows;
}
