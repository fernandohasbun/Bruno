import { env } from "../config/env.js";

const INSTANTLY_BASE_URL = "https://api.instantly.ai";

async function instantlyFetch(path: string, init?: RequestInit) {
  if (!env.INSTANTLY_API_KEY) {
    throw new Error("INSTANTLY_API_KEY is not configured");
  }

  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${env.INSTANTLY_API_KEY}`);
  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${INSTANTLY_BASE_URL}${path}`, {
    ...init,
    headers
  });

  if (!response.ok) {
    throw new Error(`Instantly API failed: ${response.status} ${await response.text()}`);
  }

  return response.json() as Promise<unknown>;
}

function queryString(params: Record<string, string | number | boolean | undefined>) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      searchParams.set(key, String(value));
    }
  }

  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

function itemsFromListResponse<T extends object>(response: unknown): T[] {
  if (!response || typeof response !== "object" || !("items" in response)) {
    throw new Error("Instantly API returned an unexpected list response");
  }

  const { items } = response as { items: unknown };
  if (!Array.isArray(items)) {
    throw new Error("Instantly API returned an unexpected items payload");
  }

  return items as T[];
}

export interface InstantlyAccount {
  email: string;
  status?: number;
  setup_pending?: boolean;
  stat_warmup_score?: number;
}

export interface InstantlyCampaign {
  id: string;
  name: string;
  status?: number;
  email_list?: string[];
  open_tracking?: boolean;
  link_tracking?: boolean | null;
  timestamp_updated?: string;
}

export interface InstantlyCampaignDetail extends InstantlyCampaign {
  campaign_schedule?: unknown;
  daily_limit?: number | null;
  daily_max_leads?: number | null;
  email_gap?: number | null;
  random_wait_max?: number | null;
  sequences?: unknown;
  text_only?: boolean | null;
  first_email_text_only?: boolean | null;
  stop_on_reply?: boolean | null;
  allow_risky_contacts?: boolean | null;
  disable_bounce_protect?: boolean | null;
}

export interface InstantlyCampaignPayload {
  name: string;
  campaign_schedule: {
    schedules: Array<{
      name: string;
      timing: {
        from: string;
        to: string;
      };
      days: Record<string, boolean>;
      timezone: string;
    }>;
    start_date?: string;
    end_date?: string;
  };
  pl_value?: number | null;
  is_evergreen?: boolean | null;
  sequences?: Array<{
    steps: Array<{
      type: "email";
      delay: number;
      delay_unit: "days";
      pre_delay: number;
      pre_delay_unit: "days";
      variants: Array<{
        subject: string;
        body: string;
        v_disabled?: boolean;
      }>;
    }>;
  }>;
  email_gap?: number | null;
  random_wait_max?: number | null;
  text_only?: boolean | null;
  first_email_text_only?: boolean | null;
  email_list?: string[];
  daily_limit?: number | null;
  stop_on_reply?: boolean | null;
  link_tracking?: boolean | null;
  open_tracking?: boolean;
  stop_on_auto_reply?: boolean | null;
  daily_max_leads?: number | null;
  prioritize_new_leads?: boolean | null;
  match_lead_esp?: boolean | null;
  stop_for_company?: boolean | null;
  insert_unsubscribe_header?: boolean | null;
  allow_risky_contacts?: boolean | null;
  disable_bounce_protect?: boolean | null;
  limit_emails_per_company_override?: {
    mode: "custom" | "disabled";
    daily_limit: number;
    scope?: "per_campaign" | "across_workspace";
  };
}

export async function listInstantlyAccounts(input: { limit?: number; includeTags?: boolean } = {}) {
  const response = await instantlyFetch(
    `/api/v2/accounts${queryString({
      limit: input.limit ?? 100,
      include_tags: input.includeTags
    })}`
  );

  return itemsFromListResponse<InstantlyAccount>(response);
}

export async function listInstantlyCampaigns(input: { search?: string; limit?: number } = {}) {
  const response = await instantlyFetch(
    `/api/v2/campaigns${queryString({
      limit: input.limit ?? 100,
      search: input.search
    })}`
  );

  return itemsFromListResponse<InstantlyCampaign>(response);
}

export async function getInstantlyCampaign(id: string) {
  return instantlyFetch(`/api/v2/campaigns/${id}`) as Promise<InstantlyCampaignDetail>;
}

// ---------------------------------------------------------------------------
// Read layer — the outbound agent's live "eyes" into the Instantly account.
// Every endpoint below was verified against the live v2 API during setup.
// ---------------------------------------------------------------------------

export interface InstantlyCampaignAnalyticsOverview {
  open_count: number;
  open_count_unique: number;
  open_count_unique_by_step?: number;
  reply_count: number;
  reply_count_unique: number;
  reply_count_unique_by_step?: number;
  link_click_count: number;
  link_click_count_unique?: number;
  link_click_count_unique_by_step?: number;
  bounced_count: number;
  unsubscribed_count: number;
  emails_sent_count: number;
  contacted_count: number;
  new_leads_contacted_count: number;
  total_opportunities: number;
  total_opportunity_value: number;
  total_interested?: number;
  total_meeting_booked?: number;
  total_meeting_completed?: number;
  total_closed?: number;
}

export interface InstantlyCampaignStepAnalytics {
  step: string | null;
  variant: string | null;
  sent: number;
  opened: number;
  unique_opened: number;
  replies: number;
  unique_replies: number;
  replies_automatic: number;
  unique_replies_automatic: number;
  clicks: number;
  unique_clicks: number;
  opportunities?: number;
  unique_opportunities?: number;
}

/** Aggregate performance for one campaign (sent, opens, replies, bounces, opportunities). */
export async function getCampaignAnalyticsOverview(
  input: string | { campaignId?: string; startDate?: string; endDate?: string }
) {
  const params = typeof input === "string" ? { campaignId: input } : input;
  const response = await instantlyFetch(
    `/api/v2/campaigns/analytics/overview${queryString({
      id: params.campaignId,
      start_date: params.startDate,
      end_date: params.endDate
    })}`
  );
  return response as InstantlyCampaignAnalyticsOverview;
}

/** Per-step and A/Z-variant performance for one campaign. */
export async function getCampaignStepAnalytics(input: {
  campaignId: string;
  startDate?: string;
  endDate?: string;
}) {
  const response = await instantlyFetch(
    `/api/v2/campaigns/analytics/steps${queryString({
      campaign_id: input.campaignId,
      start_date: input.startDate,
      end_date: input.endDate,
      include_opportunities_count: true
    })}`
  );
  if (!Array.isArray(response)) {
    throw new Error("Instantly API returned an unexpected step analytics response");
  }
  return response as InstantlyCampaignStepAnalytics[];
}

export interface InstantlyEmailSummary {
  id?: string;
  messageId?: string;
  timestampCreated?: string;
  timestampEmail?: string;
  subject?: string;
  fromEmail?: string;
  toEmail?: string;
  leadEmail?: string;
  leadId?: string;
  campaignId?: string;
  threadId?: string;
  eaccount?: string;
  preview?: string;
  threadText?: string;
  raw?: unknown;
}

export interface InstantlyEmailRecord extends InstantlyEmailSummary {
  listId?: string;
  direction: "sent" | "received" | "manual";
  step?: string;
  variant?: string;
  bodyText?: string;
  bodyHtml?: string;
  isUnread?: boolean;
  isAutoReply?: boolean;
  isFocused?: boolean;
  emailStatus?: number;
}

function normalizeEmail(raw: unknown): InstantlyEmailSummary {
  const e = (raw ?? {}) as Record<string, unknown>;
  const body = (e.body ?? {}) as Record<string, unknown>;
  const bodyText = typeof body.text === "string" ? body.text : "";
  const bodyHtml = typeof body.html === "string" ? body.html : "";
  const preview = typeof e.content_preview === "string" ? e.content_preview : "";
  const text = bodyText || stripHtml(bodyHtml) || preview;
  const toList = e.to_address_email_list;
  return {
    id: typeof e.id === "string" ? e.id : undefined,
    messageId: typeof e.message_id === "string" ? e.message_id : undefined,
    timestampCreated: typeof e.timestamp_created === "string" ? e.timestamp_created : undefined,
    timestampEmail: typeof e.timestamp_email === "string" ? e.timestamp_email : undefined,
    subject: typeof e.subject === "string" ? e.subject : undefined,
    fromEmail: typeof e.from_address_email === "string" ? e.from_address_email : undefined,
    toEmail: typeof toList === "string" ? toList : Array.isArray(toList) ? String(toList[0] ?? "") : undefined,
    leadEmail: typeof e.lead === "string" ? e.lead : typeof e.from_address_email === "string" ? e.from_address_email : undefined,
    leadId: typeof e.lead_id === "string" ? e.lead_id : undefined,
    campaignId: typeof e.campaign_id === "string" ? e.campaign_id : undefined,
    threadId: typeof e.thread_id === "string" ? e.thread_id : undefined,
    eaccount: typeof e.eaccount === "string" ? e.eaccount : undefined,
    preview: text ? normalizeWhitespace(text).slice(0, 280) : undefined,
    threadText: text ? normalizeWhitespace(text) : undefined,
    raw
  };
}

export function normalizeEmailRecord(raw: unknown): InstantlyEmailRecord {
  const e = (raw ?? {}) as Record<string, unknown>;
  const body = (e.body ?? {}) as Record<string, unknown>;
  const summary = normalizeEmail(raw);
  const explicitType = typeof e.email_type === "string" ? e.email_type : undefined;
  const ueType = typeof e.ue_type === "number" ? e.ue_type : undefined;
  const direction =
    explicitType === "received" || ueType === 2
      ? "received"
      : explicitType === "manual" || ueType === 3
        ? "manual"
        : "sent";

  return {
    ...summary,
    listId: typeof e.list_id === "string" ? e.list_id : undefined,
    direction,
    step: typeof e.step === "string" ? e.step : undefined,
    variant:
      typeof e.variant === "string" || typeof e.variant === "number"
        ? String(e.variant)
        : undefined,
    bodyText: typeof body.text === "string" ? body.text : undefined,
    bodyHtml: typeof body.html === "string" ? body.html : undefined,
    isUnread: typeof e.is_unread === "boolean" ? e.is_unread : e.is_unread === 1,
    isAutoReply: typeof e.is_auto_reply === "boolean" ? e.is_auto_reply : e.is_auto_reply === 1,
    isFocused: typeof e.is_focused === "boolean" ? e.is_focused : e.is_focused === 1,
    emailStatus: typeof e.i_status === "number" ? e.i_status : undefined
  };
}

/** Cursor-paginated workspace email ledger, including exact rendered bodies. */
export async function listInstantlyEmailsPage(input: {
  limit?: number;
  startingAfter?: string;
  minTimestampCreated?: string;
  maxTimestampCreated?: string;
  sortOrder?: "asc" | "desc";
  campaignId?: string;
  lead?: string;
  eaccount?: string;
  emailType?: "sent" | "received" | "manual";
  scheduledOnly?: boolean;
}) {
  const response = (await instantlyFetch(
    `/api/v2/emails${queryString({
      limit: input.limit ?? 100,
      starting_after: input.startingAfter,
      min_timestamp_created: input.minTimestampCreated,
      max_timestamp_created: input.maxTimestampCreated,
      sort_order: input.sortOrder ?? "asc",
      campaign_id: input.campaignId,
      lead: input.lead,
      eaccount: input.eaccount,
      email_type: input.emailType,
      scheduled_only: input.scheduledOnly
    })}`
  )) as { items?: unknown; next_starting_after?: string };
  const items = Array.isArray(response.items) ? response.items : [];
  return {
    messages: items.map(normalizeEmailRecord),
    nextStartingAfter: response.next_starting_after
  };
}

/** Recent inbound replies for a campaign (email_type=received), newest first. */
export async function listRecentReplies(input: {
  campaignId?: string;
  limit?: number;
  latestOfThread?: boolean;
  minTimestampCreated?: string;
} = {}) {
  const response = await instantlyFetch(
    `/api/v2/emails${queryString({
      campaign_id: input.campaignId,
      email_type: "received",
      limit: input.limit ?? 20,
      sort_order: "desc",
      latest_of_thread: input.latestOfThread ?? true,
      min_timestamp_created: input.minTimestampCreated
    })}`
  );
  return itemsFromListResponse<Record<string, unknown>>(response).map(normalizeEmail);
}

export interface InstantlyLeadSummary {
  id?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  jobTitle?: string;
  customFields: Record<string, string>;
  status?: number;
}

function normalizeLead(raw: unknown): InstantlyLeadSummary {
  const l = (raw ?? {}) as Record<string, unknown>;
  const payload = (l.payload ?? {}) as Record<string, unknown>;
  const customFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "string" && value) customFields[key] = value;
  }
  return {
    id: typeof l.id === "string" ? l.id : undefined,
    email: typeof l.email === "string" ? l.email : undefined,
    firstName: typeof l.first_name === "string" ? l.first_name : undefined,
    lastName: typeof l.last_name === "string" ? l.last_name : undefined,
    companyName: typeof l.company_name === "string" ? l.company_name : undefined,
    jobTitle: typeof l.job_title === "string" ? l.job_title : undefined,
    customFields,
    status: typeof l.status === "number" ? l.status : undefined
  };
}

async function fetchLeadsPage(campaignId: string, limit: number, startingAfter?: string) {
  const response = (await instantlyFetch("/api/v2/leads/list", {
    method: "POST",
    body: JSON.stringify({ campaign: campaignId, limit, starting_after: startingAfter })
  })) as { items?: unknown; next_starting_after?: string };
  const items = Array.isArray(response.items) ? response.items : [];
  return { items, nextStartingAfter: response.next_starting_after };
}

/** A page of leads in a campaign. */
export async function listCampaignLeads(input: { campaignId: string; limit?: number }) {
  const { items } = await fetchLeadsPage(input.campaignId, input.limit ?? 25);
  return items.map(normalizeLead);
}

/**
 * Count leads in a campaign by paging (bounded so a huge list can't run away).
 * Returns the count and whether the cap was hit.
 */
export async function countCampaignLeads(input: { campaignId: string; maxPages?: number; pageSize?: number }) {
  const pageSize = input.pageSize ?? 100;
  const maxPages = input.maxPages ?? 20;
  let count = 0;
  let cursor: string | undefined;
  let pages = 0;

  do {
    const { items, nextStartingAfter } = await fetchLeadsPage(input.campaignId, pageSize, cursor);
    count += items.length;
    cursor = nextStartingAfter;
    pages += 1;
  } while (cursor && pages < maxPages);

  return { count, capped: Boolean(cursor) };
}

export interface InstantlyLeadEngagement {
  email: string;
  openCount: number;
  clickCount: number;
  replyCount: number;
  /** 1 active · 2 paused · 3 finished · -1 bounced · -2 unsubscribed · -3 skipped */
  status?: number;
  lastContactAt?: string;
  lastStepId?: string;
  lastStepFrom?: string;
}

export function leadStatusLabel(status?: number) {
  switch (status) {
    case 1: return "in sequence";
    case 2: return "sequence paused";
    case 3: return "sequence finished";
    case -1: return "bounced";
    case -2: return "unsubscribed";
    case -3: return "skipped";
    default: return undefined;
  }
}

/** Per-lead engagement counters straight off the Instantly lead record. */
export async function getLeadEngagement(input: { email: string; campaignId?: string }): Promise<InstantlyLeadEngagement | undefined> {
  const response = (await instantlyFetch("/api/v2/leads/list", {
    method: "POST",
    body: JSON.stringify({ search: input.email, campaign: input.campaignId, limit: 5 })
  })) as { items?: unknown };
  const items = Array.isArray(response.items) ? (response.items as Array<Record<string, unknown>>) : [];
  const match = items.find((l) => typeof l.email === "string" && l.email.toLowerCase() === input.email.toLowerCase());
  if (!match) return undefined;

  const summary = (match.status_summary ?? {}) as { lastStep?: { from?: string; stepID?: string } };
  return {
    email: input.email,
    openCount: typeof match.email_open_count === "number" ? match.email_open_count : 0,
    clickCount: typeof match.email_click_count === "number" ? match.email_click_count : 0,
    replyCount: typeof match.email_reply_count === "number" ? match.email_reply_count : 0,
    status: typeof match.status === "number" ? match.status : undefined,
    lastContactAt: typeof match.timestamp_last_contact === "string" ? match.timestamp_last_contact : undefined,
    lastStepId: typeof summary.lastStep?.stepID === "string" ? summary.lastStep.stepID : undefined,
    lastStepFrom: typeof summary.lastStep?.from === "string" ? summary.lastStep.from : undefined
  };
}

/** Instantly CRM interest pipeline (lt_interest_status). */
export function interestStatusLabel(status?: number) {
  switch (status) {
    case 0: return "out of office";
    case 1: return "interested";
    case 2: return "meeting booked";
    case 3: return "meeting completed";
    case 4: return "closed";
    case -1: return "not interested";
    case -2: return "wrong person";
    case -3: return "lost";
    default: return undefined;
  }
}

export interface InstantlyLeadRecord extends InstantlyLeadEngagement {
  id?: string;
  campaignId?: string;
  listId?: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  companyDomain?: string;
  jobTitle?: string;
  interestStatus?: number;
  verificationStatus?: number;
  createdAt?: string;
  updatedAt?: string;
  lastOpenAt?: string;
  lastReplyAt?: string;
  lastClickAt?: string;
  /** Custom fields carried from the CSV/Apollo import. */
  customFields: Record<string, string>;
  raw?: Record<string, unknown>;
}

function toLeadRecord(raw: Record<string, unknown>, email: string): InstantlyLeadRecord {
  const summary = (raw.status_summary ?? {}) as { lastStep?: { from?: string; stepID?: string } };
  const payload = (raw.payload ?? {}) as Record<string, unknown>;
  const customFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "string" && value && !["firstName", "lastName", "email", "companyName", "campaign", "website"].includes(key)) {
      customFields[key] = value;
    }
  }
  return {
    id: typeof raw.id === "string" ? raw.id : undefined,
    email,
    openCount: typeof raw.email_open_count === "number" ? raw.email_open_count : 0,
    clickCount: typeof raw.email_click_count === "number" ? raw.email_click_count : 0,
    replyCount: typeof raw.email_reply_count === "number" ? raw.email_reply_count : 0,
    status: typeof raw.status === "number" ? raw.status : undefined,
    lastContactAt: typeof raw.timestamp_last_contact === "string" ? raw.timestamp_last_contact : undefined,
    lastStepId: typeof summary.lastStep?.stepID === "string" ? summary.lastStep.stepID : undefined,
    lastStepFrom: typeof summary.lastStep?.from === "string" ? summary.lastStep.from : undefined,
    campaignId: typeof raw.campaign === "string" ? raw.campaign : undefined,
    listId: typeof raw.list_id === "string" ? raw.list_id : undefined,
    firstName: typeof raw.first_name === "string" ? raw.first_name : undefined,
    lastName: typeof raw.last_name === "string" ? raw.last_name : undefined,
    companyName: typeof raw.company_name === "string" ? raw.company_name : undefined,
    companyDomain: typeof raw.company_domain === "string" ? raw.company_domain : undefined,
    jobTitle: typeof raw.job_title === "string" ? raw.job_title : undefined,
    interestStatus: typeof raw.lt_interest_status === "number" ? raw.lt_interest_status : undefined,
    verificationStatus: typeof raw.verification_status === "number" ? raw.verification_status : undefined,
    createdAt: typeof raw.timestamp_created === "string" ? raw.timestamp_created : undefined,
    updatedAt: typeof raw.timestamp_updated === "string" ? raw.timestamp_updated : undefined,
    lastOpenAt: typeof raw.timestamp_last_open === "string" ? raw.timestamp_last_open : undefined,
    lastReplyAt: typeof raw.timestamp_last_reply === "string" ? raw.timestamp_last_reply : undefined,
    lastClickAt: typeof raw.timestamp_last_click === "string" ? raw.timestamp_last_click : undefined,
    customFields,
    raw
  };
}

/** Full lead record (identity, pipeline state, engagement, custom fields). */
export async function getLeadRecord(input: { email: string; campaignId?: string }): Promise<InstantlyLeadRecord | undefined> {
  const response = (await instantlyFetch("/api/v2/leads/list", {
    method: "POST",
    body: JSON.stringify({ search: input.email, campaign: input.campaignId, limit: 5 })
  })) as { items?: unknown };
  const items = Array.isArray(response.items) ? (response.items as Array<Record<string, unknown>>) : [];
  const match = items.find((l) => typeof l.email === "string" && l.email.toLowerCase() === input.email.toLowerCase());
  return match ? toLeadRecord(match, input.email) : undefined;
}

/** A page of full lead records for the CRM view (cursor-paginated, optional search). */
export async function listLeadRecordsPage(input: { campaignId?: string; search?: string; limit?: number; startingAfter?: string }) {
  return listInstantlyLeadsPage(input);
}

/** Cursor-paginated lead records without application-level caps. */
export async function listInstantlyLeadsPage(input: {
  campaignId?: string;
  search?: string;
  limit?: number;
  startingAfter?: string;
  distinctContacts?: boolean;
}) {
  const response = (await instantlyFetch("/api/v2/leads/list", {
    method: "POST",
    body: JSON.stringify({
      campaign: input.campaignId,
      search: input.search,
      limit: input.limit ?? 100,
      starting_after: input.startingAfter,
      distinct_contacts: input.distinctContacts
    })
  })) as { items?: unknown; next_starting_after?: string };
  const items = Array.isArray(response.items) ? (response.items as Array<Record<string, unknown>>) : [];
  return {
    leads: items
      .filter((l) => typeof l.email === "string")
      .map((l) => toLeadRecord(l, l.email as string)),
    nextStartingAfter: response.next_starting_after
  };
}

export interface LeadEmailItem {
  direction: "sent" | "received";
  at?: string;
  subject?: string;
  from?: string;
  to?: string;
  text?: string;
}

/** Full correspondence with one lead, oldest first. Verified live (lead= filter). */
export async function listLeadEmails(input: { leadEmail: string; limit?: number }): Promise<LeadEmailItem[]> {
  const response = await instantlyFetch(
    `/api/v2/emails${queryString({ lead: input.leadEmail, limit: input.limit ?? 50, sort_order: "asc" })}`
  );
  return itemsFromListResponse<Record<string, unknown>>(response).map((raw) => {
    const normalized = normalizeEmail(raw);
    // ue_type 1 = sent from our inbox; 2 = received from the prospect.
    const direction = raw.ue_type === 2 || raw.email_type === "received" ? "received" : "sent";
    return {
      direction,
      at: normalized.timestampEmail ?? normalized.timestampCreated,
      subject: normalized.subject,
      from: normalized.fromEmail,
      to: normalized.toEmail,
      text: normalized.threadText
    };
  });
}

export interface InstantlyWarmupDay {
  date: string;
  sent: number;
  landedInbox: number;
  received: number;
}

export interface InstantlyWarmupSummary {
  email: string;
  today?: InstantlyWarmupDay;
  last7DaysSent: number;
  inboxLandingRate: number;
}

/** Per-inbox warmup health: today's warmup volume, 7-day totals, inbox-landing rate. */
export async function getWarmupAnalytics(emails: string[]): Promise<InstantlyWarmupSummary[]> {
  const response = (await instantlyFetch("/api/v2/accounts/warmup-analytics", {
    method: "POST",
    body: JSON.stringify({ emails })
  })) as { email_date_data?: Record<string, Record<string, { sent?: number; landed_inbox?: number; received?: number }>> };

  const perEmail = response.email_date_data ?? {};
  return emails.map((email) => {
    const days = perEmail[email] ?? {};
    const sortedDates = Object.keys(days).sort();
    const last7 = sortedDates.slice(-7);
    const last7DaysSent = last7.reduce((sum, d) => sum + (days[d]?.sent ?? 0), 0);
    const last7DaysLanded = last7.reduce((sum, d) => sum + (days[d]?.landed_inbox ?? 0), 0);
    const latest = sortedDates[sortedDates.length - 1];
    return {
      email,
      today: latest
        ? {
            date: latest,
            sent: days[latest]?.sent ?? 0,
            landedInbox: days[latest]?.landed_inbox ?? 0,
            received: days[latest]?.received ?? 0
          }
        : undefined,
      last7DaysSent,
      inboxLandingRate: last7DaysSent > 0 ? last7DaysLanded / last7DaysSent : 1
    };
  });
}

export async function createInstantlyCampaign(payload: InstantlyCampaignPayload) {
  return instantlyFetch("/api/v2/campaigns", {
    method: "POST",
    body: JSON.stringify(payload)
  }) as Promise<InstantlyCampaign>;
}

export async function patchInstantlyCampaign(id: string, payload: Partial<InstantlyCampaignPayload>) {
  return instantlyFetch(`/api/v2/campaigns/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  }) as Promise<InstantlyCampaign>;
}

export async function activateInstantlyCampaign(id: string) {
  return instantlyFetch(`/api/v2/campaigns/${id}/activate`, {
    method: "POST"
  }) as Promise<InstantlyCampaign>;
}

export async function pauseInstantlyCampaign(id: string) {
  return instantlyFetch(`/api/v2/campaigns/${id}/pause`, {
    method: "POST"
  }) as Promise<InstantlyCampaign>;
}

export interface InstantlyLeadImport {
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  job_title?: string;
  website?: string;
  phone?: string;
  custom_variables?: Record<string, string | number | boolean | null>;
}

export interface InstantlyBulkLeadImportResult {
  status: string;
  total_sent: number;
  leads_uploaded: number;
  in_blocklist: number;
  duplicated_leads: number;
  skipped_count: number;
  invalid_email_count: number;
  incomplete_count: number;
  duplicate_email_count: number;
  remaining_in_plan?: number | null;
  created_leads?: Array<{ id: string; email: string; index: number }>;
}

/** Add up to 1,000 leads to a campaign in one idempotent bulk request. */
export async function addLeadsToInstantlyCampaign(input: {
  campaignId: string;
  leads: InstantlyLeadImport[];
  skipIfInWorkspace?: boolean;
}) {
  if (input.leads.length < 1 || input.leads.length > 1000) {
    throw new Error(`Instantly bulk lead imports require 1-1000 leads; received ${input.leads.length}`);
  }

  return instantlyFetch("/api/v2/leads/add", {
    method: "POST",
    body: JSON.stringify({
      campaign_id: input.campaignId,
      leads: input.leads,
      verify_leads_on_import: false,
      skip_if_in_workspace: input.skipIfInWorkspace ?? true,
      skip_if_in_campaign: true,
      skip_if_in_list: false
    })
  }) as Promise<InstantlyBulkLeadImportResult>;
}

/**
 * Reply to a received email from one of our inboxes.
 * NOT yet verified against the live v2 API (no real replies existed at build
 * time) — verify the field names on the first live send before trusting it.
 */
export async function sendReplyEmail(input: {
  replyToUuid: string;
  eaccount: string;
  subject: string;
  bodyText: string;
}) {
  return instantlyFetch("/api/v2/emails/reply", {
    method: "POST",
    body: JSON.stringify({
      reply_to_uuid: input.replyToUuid,
      eaccount: input.eaccount,
      subject: input.subject,
      body: {
        text: input.bodyText,
        html: plainTextToEmailHtml(input.bodyText)
      }
    })
  });
}

/** Preserve human-authored paragraphs in clients that render the HTML body. */
export function plainTextToEmailHtml(text: string) {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return "";

  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeEmailHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function escapeEmailHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function stopLeadSequence(input: { email?: string; leadId?: string; campaignId?: string }) {
  if (!env.INSTANTLY_API_KEY) return;
  if (!input.email) {
    throw new Error("Cannot update Instantly lead interest status without a lead email");
  }

  await instantlyFetch("/api/v2/leads/update-interest-status", {
    method: "POST",
    body: JSON.stringify({
      lead_email: input.email,
      interest_value: 1,
      campaign_id: input.campaignId
    })
  });
}

/** Set a lead's CRM pipeline status (lt_interest_status) from the console. */
export async function setLeadInterest(input: { email: string; interestValue: number; campaignId?: string }) {
  await instantlyFetch("/api/v2/leads/update-interest-status", {
    method: "POST",
    body: JSON.stringify({
      lead_email: input.email,
      interest_value: input.interestValue,
      campaign_id: input.campaignId
    })
  });
}

export async function suppressLead(input: { email?: string; leadId?: string; reason: string }) {
  if (!env.INSTANTLY_API_KEY) return;
  if (!input.email) {
    throw new Error("Cannot create Instantly block-list entry without an email");
  }

  await instantlyFetch("/api/v2/block-lists-entries", {
    method: "POST",
    body: JSON.stringify({
      bl_value: input.email
    })
  });
}

function stripHtml(html: string) {
  return html.replace(/<[^>]+>/g, " ");
}

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, " ").trim();
}
