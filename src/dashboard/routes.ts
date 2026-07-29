import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { runOutboundAgent } from "../agents/outboundAgent.js";
import { KINTA_PERSONA_CAMPAIGNS } from "../campaigns/kintaPersonaCampaigns.js";
import { env, isProduction } from "../config/env.js";
import { getConfigValue, isAgentPaused, setAgentPaused } from "../db/config.js";
import {
  appendConversationTurn,
  getChannelLatestAt,
  listWebSessions,
  loadChannelConversation,
  loadConversation,
  type WebChatSession
} from "../db/conversations.js";
import {
  claimDraftForSend,
  getDraftWithContext,
  getLeadActivity,
  getRecentReplySummary,
  listPendingDrafts,
  listRecentApprovals,
  listRecentClassifications,
  markDraftSent,
  recordApproval,
  rejectDraft,
  releaseDraftClaim,
  searchLeadsLocal,
  type PendingDraftRow
} from "../db/dashboard.js";
import {
  getIntentCountsSince,
  getOldestQueuedJobAgeMinutes,
  getPendingDraftCount,
  getQueueSummary,
  listPersonaProfitability,
  listRecentDailyMetrics
} from "../db/metrics.js";
import { cachedFetch, deleteCachedValue } from "../db/cache.js";
import { cancelRetargetById, listAwayLeads } from "../db/retargets.js";
import type { ReplyIntent } from "../types/domain.js";
import { clearFailedJobs, getFailedJobGroups, retryLatestFailedJob } from "../db/ops.js";
import {
  getCrmLeadByEmail,
  getCrmMessageSummary,
  getCrmSummary,
  getLatestReconciliation,
  listCrmLeadMessages,
  listCrmLeadsPage,
  listCrmMessagesPage,
  listRecentAgentActions,
  listSyncCheckpoints,
  recordAgentAction,
  CRM_LEAD_VIEWS,
  type CrmLeadView
} from "../db/crm.js";
import {
  createLesson,
  listLessons,
  setLessonStatus,
  type LessonKind,
  type LessonStatus
} from "../db/lessons.js";
import { hasClaudeKey } from "../integrations/claude.js";
import { UPDATES_THREAD_KEY } from "../integrations/notify.js";
import {
  activateInstantlyCampaign,
  getCampaignAnalyticsOverview,
  getInstantlyCampaign,
  getLeadEngagement,
  getLeadRecord,
  getWarmupAnalytics,
  interestStatusLabel,
  leadStatusLabel,
  listInstantlyCampaigns,
  listLeadEmails,
  listLeadRecordsPage,
  patchInstantlyCampaign,
  pauseInstantlyCampaign,
  sendReplyEmail,
  setLeadInterest,
  type InstantlyLeadEngagement,
  type InstantlyLeadRecord,
  type LeadEmailItem
} from "../integrations/instantly.js";
import {
  renderBrunoPage,
  renderActivityPage,
  renderCampaignPage,
  renderInboxPage,
  renderLeadPage,
  renderLeadsPage,
  renderLearningPage,
  renderSearchPage,
  renderSystemPage,
  type AwayModel,
  type CrmRow,
  type DraftCardModel,
  type ReplyFeedModel,
  type SearchResultRow,
  type TimelineItem
} from "./pages.js";
import { renderMessagePage, renderShell, type ShellContext } from "./ui.js";

const COOKIE_NAME = "bruno_dash";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 60; // 60 days
const CHAT_ID_PATTERN = /^[A-Za-z0-9-]{3,40}$/;

function threadKeyFor(chatId: string) {
  // "updates" is the reserved id for Bruno's proactive channel.
  return chatId === "updates" ? UPDATES_THREAD_KEY : `web:${chatId}`;
}

function modelLabel() {
  return env.CLAUDE_STRONG_MODEL
    .replace(/^claude-/, "")
    .replace(/-\d{8}$/, "")
    .replace(/(\d)-(\d)/g, "$1.$2")
    .replace(/-/g, " ");
}

// ————— Auth —————

function secretMatches(candidate: string) {
  if (!env.DASHBOARD_SECRET || !candidate) return false;
  // Hash both sides so timingSafeEqual never sees mismatched lengths.
  const a = crypto.createHash("sha256").update(candidate).digest();
  const b = crypto.createHash("sha256").update(env.DASHBOARD_SECRET).digest();
  return crypto.timingSafeEqual(a, b);
}

function readAuthCookie(request: FastifyRequest) {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function isAuthorized(request: FastifyRequest) {
  const cookie = readAuthCookie(request);
  return cookie !== undefined && secretMatches(cookie);
}

function setAuthCookie(reply: FastifyReply, value: string) {
  const attributes = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/dashboard",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`
  ];
  if (isProduction) attributes.push("Secure");
  reply.header("set-cookie", attributes.join("; "));
}

/**
 * Shared gate for the HTML pages: handles the ?key= login link (works on any
 * page path), the not-configured case, and the 401 page. Returns true when the
 * request may proceed.
 */
function authorizePage(request: FastifyRequest, reply: FastifyReply, path: string): boolean {
  if (!env.DASHBOARD_SECRET) {
    void reply
      .code(503)
      .type("text/html")
      .send(
        renderMessagePage(
          "Dashboard not configured",
          "Set the DASHBOARD_SECRET environment variable to enable the dashboard.",
          "503 · service unavailable"
        )
      );
    return false;
  }

  const key = (request.query as Record<string, unknown>)?.key;
  if (typeof key === "string" && secretMatches(key)) {
    setAuthCookie(reply, key);
    // Preserve the rest of the query string (e.g. ?email=… on the dossier).
    const url = new URL(request.url, "http://local");
    url.searchParams.delete("key");
    void reply.redirect(`${path}${url.search}`, 302);
    return false;
  }

  if (!isAuthorized(request)) {
    void reply
      .code(401)
      .type("text/html")
      .send(
        renderMessagePage(
          "Access required",
          "Open the console through the private link you were given. If the link stopped working, ask for a fresh one.",
          "401 · not signed in"
        )
      );
    return false;
  }

  return true;
}

// ————— Shared shell data —————

async function loadShellContext(
  active: ShellContext["active"],
  title: string,
  autoRefresh: boolean,
  options: { activeChatId?: string; sessions?: WebChatSession[] } = {}
): Promise<ShellContext> {
  const sessions = options.sessions ?? (await listWebSessions(12));
  const dockChatId = sessions[0]?.chatId ?? "console";
  const [agentPaused, pendingCount, queue, dockTurns, updatesLatestAt] = await Promise.all([
    isAgentPaused(),
    getPendingDraftCount(),
    getQueueSummary(),
    active === "bruno" ? Promise.resolve(undefined) : loadConversation(threadKeyFor(dockChatId), 8),
    getChannelLatestAt(UPDATES_THREAD_KEY)
  ]);

  return {
    active,
    title,
    pendingCount,
    failedJobs: queue.failed ?? 0,
    agentPaused,
    generatedAt: new Date(),
    autoRefresh,
    dockTurns,
    sessions: sessions.map((s) => ({ chatId: s.chatId, title: s.title, lastAt: s.lastAt })),
    activeChatId: options.activeChatId,
    dockChatId,
    updatesLatestAt
  };
}

// ————— Draft helpers —————

/**
 * Pull the Instantly identifiers a reply-send needs out of the stored event
 * payload (shape produced by processReplyPoll → normalizeInstantlyEvent).
 */
function extractSendContext(payload: unknown) {
  const record = (payload ?? {}) as Record<string, unknown>;
  const data = (record.data ?? {}) as Record<string, unknown>;
  const pick = (key: string) => {
    const nested = data[key];
    if (typeof nested === "string" && nested) return nested;
    const top = record[key];
    if (typeof top === "string" && top) return top;
    return undefined;
  };

  return {
    replyToUuid: pick("id"),
    eaccount: pick("eaccount"),
    originalSubject: pick("subject")
  };
}

function defaultSubject(draftSubject: string | null, originalSubject?: string) {
  if (draftSubject?.trim()) return draftSubject.trim();
  if (originalSubject?.trim()) {
    const original = originalSubject.trim();
    return /^re:/i.test(original) ? original : `Re: ${original}`;
  }
  return "Re: your reply";
}

function toDraftCard(row: PendingDraftRow): DraftCardModel {
  const context = extractSendContext(row.event_payload);
  return {
    id: row.id,
    companyName: row.company_name ?? undefined,
    email: row.email ?? undefined,
    intent: row.intent,
    confidence: row.confidence,
    reason: row.reason,
    internalReason: row.internal_reason ?? undefined,
    prospectText: row.raw_thread ?? undefined,
    subject: defaultSubject(row.subject, context.originalSubject),
    body: row.body,
    createdAt: row.created_at,
    sendFrom: context.eaccount,
    canSend: Boolean(context.replyToUuid && context.eaccount),
    suggestedNextAction: row.suggested_next_action ?? undefined
  };
}

const approveBodySchema = z.object({
  subject: z.string().max(300).optional(),
  body: z.string().min(1).max(20000)
});

// ————— Routes —————

/** Minutes since an ISO timestamp; undefined if missing/unparseable. */
function minutesSince(iso: string | undefined) {
  if (!iso) return undefined;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return undefined;
  return Math.max(0, Math.floor((Date.now() - then) / 60000));
}

function agoLabel(minutes: number | undefined) {
  if (minutes === undefined) return undefined;
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const HOT_INTENTS = ["positive", "question", "objection"];
const HANDLED_INTENTS = ["not_now", "negative", "unsubscribe"];

export type InboxSection = "waiting" | "needs_read" | "away" | "handled";

const REPLY_INTENTS: ReplyIntent[] = [
  "positive",
  "question",
  "objection",
  "not_now",
  "negative",
  "unsubscribe",
  "out_of_office",
  "unclear"
];

/** Rows predate today's intent set, so narrow the stored text before routing it. */
export function isReplyIntent(intent: string): intent is ReplyIntent {
  return (REPLY_INTENTS as string[]).includes(intent);
}

/**
 * Total intent -> section mapping. Every reply must land in exactly one place:
 * the Inbox previously selected sections by membership in the two arrays above,
 * so out_of_office matched neither, hit no branch, and rendered nowhere at all.
 *
 * The `never` assignment is the guard — adding a ninth ReplyIntent without
 * giving it a section fails the build here instead of silently vanishing.
 */
export function inboxSection(intent: ReplyIntent): InboxSection {
  switch (intent) {
    case "positive":
    case "question":
    case "objection":
      return "waiting";
    case "unclear":
      return "needs_read";
    case "out_of_office":
      return "away";
    case "not_now":
    case "negative":
    case "unsubscribe":
      return "handled";
    default: {
      const unrouted: never = intent;
      throw new Error(`intent has no inbox section: ${String(unrouted)}`);
    }
  }
}

// ————— Live Instantly layer (cached, failure-tolerant) —————

export interface CampaignPulse {
  /** Present for a single campaign; omitted for an aggregated persona portfolio. */
  campaignId?: string;
  campaignName: string;
  statusLabel: string;
  dailyLimit?: number;
  openTracking?: boolean;
  linkTracking?: boolean;
  leadCount?: number;
  leadCountCapped?: boolean;
  sent: number;
  contacted: number;
  opensUnique: number;
  clicks: number;
  repliesUnique: number;
  bounces: number;
  unsubscribes: number;
  personas: Array<{
    persona: string;
    contacted: number;
    sent: number;
    repliesUnique: number;
    positiveReplies?: number;
    meetings?: number;
    opportunities: number;
    closed?: number;
    bounces: number;
    openTracking?: boolean;
    linkTracking?: boolean | null;
    clicks: number;
  }>;
  inboxes: Array<{ email: string; todaySent?: number; last7Sent: number; landingRate: number }>;
}

function campaignStatusLabel(status?: number) {
  switch (status) {
    case 0: return "draft";
    case 1: return "active";
    case 2: return "paused";
    case 3: return "completed";
    case 4: return "running";
    default: return "unknown";
  }
}

/**
 * One shared snapshot of the live Instantly state, cached 5 minutes. Returns
 * null when Instantly is unreachable — pages render without the live layer
 * instead of failing.
 */
async function loadCampaignPulse(): Promise<CampaignPulse | null> {
  try {
    return await cachedFetch<CampaignPulse | null>("instantly:pulse:v2", 300, async () => {
      const [campaigns, crmSummary, checkpoints] = await Promise.all([
        listInstantlyCampaigns({ limit: 100 }),
        getCrmSummary(),
        listSyncCheckpoints()
      ]);
      if (campaigns.length === 0) return null;
      const personaCampaigns = campaigns.filter((campaign) => campaign.name.startsWith("Kinta | P"));
      const selected = personaCampaigns.length > 0 ? personaCampaigns : [campaigns[0]];

      const snapshots = await Promise.all(
        selected.map(async (campaign) => {
          const [detail, analytics] = await Promise.allSettled([
            getInstantlyCampaign(campaign.id),
            getCampaignAnalyticsOverview(campaign.id)
          ]);
          return { campaign, detail, analytics };
        })
      );
      const senderEmails = [
        ...new Set(
          snapshots.flatMap((snapshot) =>
            snapshot.detail.status === "fulfilled"
              ? snapshot.detail.value.email_list ?? []
              : snapshot.campaign.email_list ?? []
          )
        )
      ];
      const warmup = await Promise.allSettled([
        senderEmails.length > 0 ? getWarmupAnalytics(senderEmails) : Promise.resolve([])
      ]);
      const details = snapshots
        .filter((snapshot) => snapshot.detail.status === "fulfilled")
        .map((snapshot) => (snapshot.detail as PromiseFulfilledResult<Awaited<ReturnType<typeof getInstantlyCampaign>>>).value);
      const analytics = snapshots
        .filter((snapshot) => snapshot.analytics.status === "fulfilled")
        .map((snapshot) => (snapshot.analytics as PromiseFulfilledResult<Awaited<ReturnType<typeof getCampaignAnalyticsOverview>>>).value);
      const leadSyncComplete = checkpoints.some(
        (checkpoint) => checkpoint.stream === "crm.leads.full" && checkpoint.status === "ok" && checkpoint.last_success_at
      );
      const countsByCampaign = new Map(
        crmSummary.campaigns.map((item) => [item.campaignId, item.total])
      );
      const dailyLimits = details
        .map((detail) => (detail as unknown as { daily_limit?: number }).daily_limit)
        .filter((limit): limit is number => typeof limit === "number");
      const statuses = new Set(selected.map((campaign) => campaignStatusLabel(campaign.status)));
      const personaRows = snapshots.flatMap((snapshot) => {
        if (snapshot.analytics.status !== "fulfilled") return [];
        const item = snapshot.analytics.value;
        const detail = snapshot.detail.status === "fulfilled" ? snapshot.detail.value : snapshot.campaign;
        const config = KINTA_PERSONA_CAMPAIGNS.find((entry) => entry.name === snapshot.campaign.name);
        return [{
          persona: config?.persona ?? snapshot.campaign.name,
          contacted: item.contacted_count,
          sent: item.emails_sent_count,
          repliesUnique: item.reply_count_unique,
          positiveReplies: item.total_interested,
          meetings: item.total_meeting_booked,
          opportunities: item.total_opportunities,
          closed: item.total_closed,
          bounces: item.bounced_count,
          openTracking: detail.open_tracking,
          linkTracking: detail.link_tracking,
          clicks: item.link_click_count_unique ?? item.link_click_count
        }];
      });

      return {
        campaignId: selected.length === 1 ? selected[0].id : undefined,
        campaignName: selected.length === 1 ? selected[0].name : `Kinta Persona Portfolio (${selected.length} campaigns)`,
        statusLabel: statuses.size === 1 ? [...statuses][0] : "mixed",
        dailyLimit: dailyLimits.length === selected.length ? dailyLimits.reduce((sum, limit) => sum + limit, 0) : undefined,
        openTracking: details.length === selected.length ? details.every((detail) => detail.open_tracking === true) : undefined,
        linkTracking: details.length === selected.length ? details.every((detail) => detail.link_tracking === true) : undefined,
        leadCount: leadSyncComplete
          ? selected.reduce((sum, campaign) => sum + (countsByCampaign.get(campaign.id) ?? 0), 0)
          : undefined,
        leadCountCapped: false,
        sent: analytics.reduce((sum, item) => sum + item.emails_sent_count, 0),
        contacted: analytics.reduce((sum, item) => sum + item.contacted_count, 0),
        opensUnique: analytics.reduce((sum, item) => sum + item.open_count_unique, 0),
        clicks: analytics.reduce((sum, item) => sum + item.link_click_count, 0),
        repliesUnique: analytics.reduce((sum, item) => sum + item.reply_count_unique, 0),
        bounces: analytics.reduce((sum, item) => sum + item.bounced_count, 0),
        unsubscribes: analytics.reduce((sum, item) => sum + item.unsubscribed_count, 0),
        personas: personaRows,
        inboxes:
          warmup[0].status === "fulfilled"
            ? warmup[0].value.map((w) => ({
                email: w.email,
                todaySent: w.today?.sent,
                last7Sent: w.last7DaysSent,
                landingRate: w.inboxLandingRate
              }))
            : []
      };
    });
  } catch {
    return null;
  }
}

function scheduleLabel(value: unknown) {
  const root = (value ?? {}) as { schedules?: unknown };
  if (!Array.isArray(root.schedules) || root.schedules.length === 0) return undefined;
  const schedule = (root.schedules[0] ?? {}) as {
    timing?: { from?: unknown; to?: unknown };
    days?: Record<string, unknown>;
    timezone?: unknown;
  };
  const activeDays = Object.entries(schedule.days ?? {})
    .filter(([, enabled]) => enabled === true)
    .map(([day]) => ({ "0": "Sun", "1": "Mon", "2": "Tue", "3": "Wed", "4": "Thu", "5": "Fri", "6": "Sat" }[day] ?? day))
    .join(", ");
  const from = typeof schedule.timing?.from === "string" ? schedule.timing.from : "?";
  const to = typeof schedule.timing?.to === "string" ? schedule.timing.to : "?";
  const timezone = typeof schedule.timezone === "string" ? schedule.timezone : "campaign timezone";
  return `${activeDays || "no active days"} · ${from}–${to} · ${timezone}`;
}

async function loadManagedCampaignControls() {
  try {
    const campaigns = (await listInstantlyCampaigns({ limit: 100 })).filter((campaign) =>
      KINTA_PERSONA_CAMPAIGNS.some((managed) => managed.name === campaign.name)
    );
    const details = await Promise.allSettled(campaigns.map((campaign) => getInstantlyCampaign(campaign.id)));
    return campaigns.map((campaign, index) => {
      const result = details[index];
      const detail = result.status === "fulfilled" ? result.value : undefined;
      return {
        id: campaign.id,
        name: campaign.name,
        status: campaignStatusLabel(detail?.status ?? campaign.status),
        dailyLimit: detail?.daily_limit ?? undefined,
        schedule: scheduleLabel(detail?.campaign_schedule)
      };
    });
  } catch {
    return [];
  }
}

/** Per-lead engagement for the people shown in the Inbox (cached 15 min each). */
async function loadEngagementMap(emails: Array<string | undefined>, campaignId?: string) {
  const unique = [...new Set(emails.filter((e): e is string => Boolean(e)))].slice(0, 12);
  const results = await Promise.allSettled(
    unique.map((email) =>
      cachedFetch<InstantlyLeadEngagement | null>(`lead-eng:${email.toLowerCase()}`, 900, async () => {
        return (await getLeadEngagement({ email, campaignId })) ?? null;
      })
    )
  );
  const map = new Map<string, InstantlyLeadEngagement>();
  results.forEach((result, index) => {
    if (result.status === "fulfilled" && result.value) map.set(unique[index].toLowerCase(), result.value);
  });
  return map;
}

function toFeedModel(row: { company_name: string | null; email: string | null; intent: string; reason: string; created_at: string; raw_thread: string | null }): ReplyFeedModel {
  return {
    companyName: row.company_name ?? undefined,
    email: row.email ?? undefined,
    intent: row.intent,
    reason: row.reason,
    createdAt: row.created_at,
    prospectText: row.raw_thread ?? undefined
  };
}

export async function registerDashboard(app: FastifyInstance) {
  // Old paths → new homes (bookmarks and older links keep working)
  for (const [from, to] of [
    ["/dashboard/approvals", "/dashboard/inbox"],
    ["/dashboard/replies", "/dashboard/inbox"],
    ["/dashboard/metrics", "/dashboard/campaign"],
    ["/dashboard/ops", "/dashboard/system"]
  ] as const) {
    app.get(from, async (_request, reply) => reply.redirect(to, 301));
  }

  // New chat session
  app.get("/dashboard/new", async (request, reply) => {
    if (!authorizePage(request, reply, "/dashboard/new")) return reply;
    return reply.redirect(`/dashboard?chat=${crypto.randomUUID()}`, 302);
  });

  // Bruno — briefing + chat home
  app.get("/dashboard", async (request, reply) => {
    if (!authorizePage(request, reply, "/dashboard")) return reply;

    const sessions = await listWebSessions(12);
    const requested = (request.query as Record<string, unknown>)?.chat;
    // No ?chat → a fresh conversation every time; history lives in the sidebar.
    const chatId =
      typeof requested === "string" && CHAT_ID_PATTERN.test(requested) ? requested : crypto.randomUUID();

    const isChannel = chatId === "updates";
    const [shell, turns, drafts, replies24h, dailyRows, lastPollAt, pulse] = await Promise.all([
      loadShellContext("bruno", isChannel ? "# updates" : "Bruno", false, { activeChatId: chatId, sessions }),
      isChannel ? loadChannelConversation(threadKeyFor(chatId), 60) : loadConversation(threadKeyFor(chatId), 40),
      listPendingDrafts(20),
      getRecentReplySummary(24),
      listRecentDailyMetrics(2),
      getConfigValue<string>("last_poll_success_at"),
      loadCampaignPulse()
    ]);

    const hottest = drafts
      .slice()
      .sort(
        (a, b) =>
          HOT_INTENTS.indexOf(a.intent) - HOT_INTENTS.indexOf(b.intent) || a.created_at.localeCompare(b.created_at)
      )[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const sendsYesterday = dailyRows
      .filter((row) => row.metric_date === yesterday)
      .reduce((sum, row) => sum + row.sends, 0);

    return reply.type("text/html").send(
      renderShell(
        shell,
        renderBrunoPage(turns, {
          agentPaused: shell.agentPaused,
          pendingCount: shell.pendingCount,
          hottestWho: hottest ? (hottest.company_name ?? hottest.email ?? undefined) : undefined,
          needsReadCount: replies24h.find((r) => r.intent === "unclear")?.count ?? 0,
          replies24h: replies24h.filter((r) => r.intent !== "unclear").map((r) => ({ intent: r.intent, count: r.count })),
          sendsYesterday: dailyRows.length > 0 ? sendsYesterday : undefined,
          failedJobs: shell.failedJobs,
          lastPollAgo: agoLabel(minutesSince(lastPollAt)),
          campaignStatus: pulse?.statusLabel,
          campaignSent: pulse?.sent,
          dailyLimit: pulse?.dailyLimit
        },
        chatId,
        modelLabel(),
        isChannel ? "channel" : "chat")
      )
    );
  });

  // Inbox — who replied, hottest first
  app.get("/dashboard/inbox", async (request, reply) => {
    if (!authorizePage(request, reply, "/dashboard/inbox")) return reply;
    const [shell, drafts, feed, activity, pulse, awayRows] = await Promise.all([
      loadShellContext("inbox", "Inbox", true),
      listPendingDrafts(20),
      listRecentClassifications(40),
      listRecentApprovals(12),
      loadCampaignPulse(),
      listAwayLeads(40)
    ]);

    const cards = drafts
      .map(toDraftCard)
      .sort(
        (a, b) => HOT_INTENTS.indexOf(a.intent) - HOT_INTENTS.indexOf(b.intent) || a.createdAt.localeCompare(b.createdAt)
      );
    // Sections come from the total mapping, so a reply cannot fall through them all.
    const sectioned = feed.filter((row) => isReplyIntent(row.intent));
    const needsRead = sectioned
      .filter((row) => inboxSection(row.intent as ReplyIntent) === "needs_read" && row.draft_status === null)
      .slice(0, 10)
      .map(toFeedModel);
    const handled = sectioned
      .filter((row) => inboxSection(row.intent as ReplyIntent) === "handled")
      .slice(0, 15)
      .map(toFeedModel);
    const away: AwayModel[] = awayRows.map((row) => ({
      email: row.email,
      companyName: row.company_name ?? undefined,
      returnDate: row.ooo_return_date ? row.ooo_return_date.toISOString().slice(0, 10) : undefined,
      alternateContact: row.ooo_alternate_contact ?? undefined,
      prospectText: row.raw_thread ?? undefined,
      createdAt: row.created_at,
      retargetId: row.retarget_id ?? undefined,
      retargetAt: row.retarget_run_after ?? undefined
    }));

    // Enrich the actionable people with their live Instantly engagement.
    const engagement = await loadEngagementMap(
      [...cards.map((c) => c.email), ...needsRead.map((r) => r.email)],
      pulse?.campaignId
    );
    for (const card of cards) {
      if (card.email) card.engagement = engagement.get(card.email.toLowerCase());
    }
    for (const row of needsRead) {
      if (row.email) row.engagement = engagement.get(row.email.toLowerCase());
    }
    const log = activity.map((row) => ({
      action: row.action,
      companyName: row.company_name ?? undefined,
      email: row.email ?? undefined,
      createdAt: row.created_at
    }));

    return reply
      .type("text/html")
      .send(
        renderShell(shell, renderInboxPage(cards, needsRead, handled, log, shell.generatedAt, pulse ?? undefined, away))
      );
  });

  // Campaign — is the machine sending, and is it working?
  app.get("/dashboard/campaign", async (request, reply) => {
    if (!authorizePage(request, reply, "/dashboard/campaign")) return reply;
    const [shell, dailyRows, pulse, profitability, controls] = await Promise.all([
      loadShellContext("campaign", "Campaign", true),
      listRecentDailyMetrics(7),
      loadCampaignPulse(),
      listPersonaProfitability(),
      loadManagedCampaignControls()
    ]);

    // metrics_daily has one row per (date, campaign); collapse to one row per date.
    const byDate = new Map<string, { date: string; contacted: number; sends: number; replies: number; bounces: number; positive: number }>();
    for (const row of dailyRows) {
      const day = byDate.get(row.metric_date) ?? { date: row.metric_date, contacted: 0, sends: 0, replies: 0, bounces: 0, positive: 0 };
      day.contacted += row.contacted;
      day.sends += row.sends;
      day.replies += row.replies;
      day.bounces += row.bounces;
      day.positive += row.positive_replies;
      byDate.set(row.metric_date, day);
    }
    const daily = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));

    return reply.type("text/html").send(
      renderShell(
        shell,
        renderCampaignPage({
          contacted7d: daily.reduce((sum, day) => sum + day.contacted, 0),
          sends7d: daily.reduce((sum, day) => sum + day.sends, 0),
          replies7d: daily.reduce((sum, day) => sum + day.replies, 0),
          bounces7d: daily.reduce((sum, day) => sum + day.bounces, 0),
          positive7d: daily.reduce((sum, day) => sum + day.positive, 0),
          daily,
          pulse: pulse ?? undefined,
          profitability,
          controls
        })
      )
    );
  });

  // System — one honest sentence; tech behind a toggle
  app.get("/dashboard/system", async (request, reply) => {
    if (!authorizePage(request, reply, "/dashboard/system")) return reply;
    const [
      shell,
      queue,
      oldestQueuedMinutes,
      groups,
      lastPollAt,
      pulse,
      sync,
      reconciliation,
      actions,
      crmSummary,
      messageSummary
    ] = await Promise.all([
      loadShellContext("system", "System", true),
      getQueueSummary(),
      getOldestQueuedJobAgeMinutes(),
      getFailedJobGroups(),
      getConfigValue<string>("last_poll_success_at"),
      loadCampaignPulse(),
      listSyncCheckpoints(),
      getLatestReconciliation(),
      listRecentAgentActions(30),
      getCrmSummary(),
      getCrmMessageSummary()
    ]);
    const pollAgeMinutes = minutesSince(lastPollAt);
    return reply.type("text/html").send(
      renderShell(
        shell,
        renderSystemPage(
          {
            agentPaused: shell.agentPaused,
            queued: queue.queued ?? 0,
            running: queue.running ?? 0,
            failed: queue.failed ?? 0,
            oldestQueuedMinutes,
            lastPollAgo: agoLabel(pollAgeMinutes),
            lastPollStale: !shell.agentPaused && pollAgeMinutes !== undefined && pollAgeMinutes > 15,
            groups,
            instantlyOk: pulse !== null,
            claudeOk: hasClaudeKey(),
            sync: sync.map((stream) => ({
              stream: stream.stream,
              status: stream.cursor ? "backfilling" : stream.status,
              records: stream.records_synced,
              currentRecords:
                stream.stream === "crm.leads.full"
                  ? crmSummary.total
                  : stream.stream === "crm.messages.incremental"
                    ? messageSummary.total
                    : undefined,
              lastSuccessAt: stream.last_success_at ?? undefined,
              error: stream.last_error ?? undefined
            })),
            reconciliation: reconciliation.map((run) => ({
              scope: run.scope,
              matches: run.matches,
              providerLeads: run.provider_leads ?? undefined,
              localLeads: run.local_leads ?? undefined,
              providerSent: run.provider_sent ?? undefined,
              localSent: run.local_sent ?? undefined,
              at: run.reconciled_at
            })),
            actions: actions.map((action) => ({
              action: action.action,
              targetType: action.target_type,
              targetId: action.target_id ?? undefined,
              actor: action.actor,
              reason: action.reason ?? undefined,
              status: action.status,
              at: action.created_at
            }))
          },
          shell.generatedAt
        )
      )
    );
  });

  // Lead dossier — everything known about one person
  app.get("/dashboard/lead", async (request, reply) => {
    if (!authorizePage(request, reply, "/dashboard/lead")) return reply;
    const emailRaw = (request.query as Record<string, unknown>)?.email;
    if (typeof emailRaw !== "string" || !emailRaw.includes("@")) return reply.redirect("/dashboard/leads", 302);
    const email = emailRaw.trim().toLowerCase();

    const [shell, pulse, activity, localLeadResult, localMessagesResult] = await Promise.all([
      loadShellContext("leads", "Lead", true),
      loadCampaignPulse(),
      getLeadActivity(email),
      getCrmLeadByEmail(email).catch(() => undefined),
      listCrmLeadMessages(email, 1000).catch(() => [])
    ]);

    let record: InstantlyLeadRecord | null = null;
    let thread: LeadEmailItem[] = [];
    let threadUnavailable = false;
    if (localLeadResult) {
      record = {
        id: localLeadResult.provider_lead_id,
        email: localLeadResult.email,
        campaignId: localLeadResult.campaign_id ?? undefined,
        firstName: localLeadResult.first_name ?? undefined,
        lastName: localLeadResult.last_name ?? undefined,
        companyName: localLeadResult.company_name ?? undefined,
        jobTitle: localLeadResult.job_title ?? undefined,
        status: localLeadResult.status ?? undefined,
        interestStatus: localLeadResult.interest_status ?? undefined,
        openCount: localLeadResult.email_open_count,
        clickCount: localLeadResult.email_click_count,
        replyCount: localLeadResult.email_reply_count,
        lastContactAt: localLeadResult.last_contact_at ?? undefined,
        customFields: localLeadResult.custom_fields
      };
    } else {
      try {
        record = await cachedFetch<InstantlyLeadRecord | null>(`lead-rec:${email}`, 600, async () => {
          return (await getLeadRecord({ email, campaignId: pulse?.campaignId })) ?? null;
        });
      } catch {
        record = null;
      }
    }
    if (localMessagesResult.length > 0) {
      thread = localMessagesResult.map((message) => ({
        id: message.provider_email_id,
        direction: message.direction === "received" ? "received" : "sent",
        at: message.timestamp_email ?? message.provider_created_at ?? message.synced_at,
        subject: message.subject ?? undefined,
        from: message.eaccount ?? undefined,
        text: message.body_text ?? message.content_preview ?? undefined
      }));
    } else {
      try {
        thread = await cachedFetch<LeadEmailItem[]>(`lead-thread:${email}`, 300, () => listLeadEmails({ leadEmail: email, limit: 50 }));
      } catch {
        threadUnavailable = true;
      }
    }

    const timeline: TimelineItem[] = [];
    for (const item of thread) {
      timeline.push(
        item.direction === "sent"
          ? { kind: "sent", at: item.at, subject: item.subject, from: item.from, text: item.text }
          : { kind: "received", at: item.at, subject: item.subject, text: item.text }
      );
    }
    for (const c of activity.classifications) {
      timeline.push({
        kind: "read",
        at: c.created_at,
        intent: c.intent,
        confidence: c.confidence,
        reason: c.reason,
        suggested: c.suggested_next_action ?? undefined
      });
    }
    for (const a of activity.approvals) {
      const cls = activity.classifications.find((c) => c.draft_id === a.draft_id);
      timeline.push({
        kind: "decision",
        at: a.created_at,
        action: a.action,
        notes: a.notes ?? undefined,
        original: cls?.draft_body ?? undefined,
        finalText: a.final_body ?? undefined
      });
    }
    for (const s of activity.suppressions) {
      timeline.push({ kind: "suppression", at: s.created_at, reason: s.reason });
    }
    timeline.sort((a, b) => (new Date(a.at ?? 0).getTime() || 0) - (new Date(b.at ?? 0).getTime() || 0));

    const name = record ? [record.firstName, record.lastName].filter(Boolean).join(" ") || undefined : undefined;
    return reply.type("text/html").send(
      renderShell(
        shell,
        renderLeadPage(
          {
            email,
            name,
            company: record?.companyName,
            interestLabel: interestStatusLabel(record?.interestStatus),
            sequenceLabel: leadStatusLabel(record?.status),
            engagement: record ?? undefined,
            customFields: record?.customFields ?? {},
            hasPendingDraft: activity.classifications.some((c) => c.draft_status === "drafted"),
            timeline,
            threadUnavailable
          },
          shell.generatedAt
        )
      )
    );
  });

  // Leads — the CRM view
  app.get("/dashboard/leads", async (request, reply) => {
    if (!authorizePage(request, reply, "/dashboard/leads")) return reply;
    const query = request.query as Record<string, unknown>;
    const page = Math.max(1, Number.parseInt(typeof query.page === "string" ? query.page : "1", 10) || 1);
    const search = typeof query.q === "string" ? query.q.trim().slice(0, 200) : undefined;
    // Defaults to the people the campaign has actually emailed. "all" is one tab
    // away and shows its count, because the full roster is mostly an import list:
    // on P2 Legal, 499 leads against 23 contacted.
    const view = CRM_LEAD_VIEWS.includes(query.view as CrmLeadView)
      ? (query.view as CrmLeadView)
      : "contacted";
    const [shell, result, summary, checkpoints] = await Promise.all([
      loadShellContext("leads", "Leads", true),
      listCrmLeadsPage({ page, pageSize: 50, search, view }),
      getCrmSummary(),
      listSyncCheckpoints()
    ]);
    const leadSync = checkpoints.find((checkpoint) => checkpoint.stream === "crm.leads.full");
    const rows: CrmRow[] = result.leads.map((lead) => {
      const tags: string[] = [];
      if (lead.email_reply_count > 0) tags.push("replied");
      if (lead.interest_status !== null && lead.interest_status >= 1) tags.push("interested");
      if (lead.status === 1 || lead.status === 2) tags.push("in-sequence");
      if (lead.status === 3) tags.push("finished");
      if (lead.status !== null && lead.status < 0) tags.push("suppressed");
      return {
        email: lead.email,
        name: [lead.first_name, lead.last_name].filter(Boolean).join(" ") || undefined,
        company: lead.company_name ?? undefined,
        persona: lead.custom_fields.persona,
        targetRole: lead.custom_fields.targetRole ?? lead.job_title ?? undefined,
        interestLabel: interestStatusLabel(lead.interest_status ?? undefined),
        sequenceLabel: leadStatusLabel(lead.status ?? undefined),
        opens: lead.email_open_count,
        clicks: lead.email_click_count,
        replies: lead.email_reply_count,
        lastContactAt: lead.last_contact_at ?? undefined,
        brunoIntent: lead.bruno_intent ?? undefined,
        brunoReturnDate: lead.bruno_return_date ? lead.bruno_return_date.toISOString().slice(0, 10) : undefined,
        tags: [...tags, lead.bruno_intent, lead.custom_fields.persona, lead.custom_fields.targetRole]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
      };
    });
    return reply.type("text/html").send(
      renderShell(
        shell,
        renderLeadsPage(
          {
            rows,
            total: result.total,
            page: result.page,
            pageSize: result.pageSize,
            search,
            view,
            summary,
            syncLabel: leadSync?.last_success_at
              ? `synced ${agoLabel(minutesSince(leadSync.last_success_at))}`
              : leadSync?.status === "running"
                ? "first sync running"
                : "waiting for first sync"
          },
          shell.generatedAt
        )
      )
    );
  });

  // Activity — exact account-wide message ledger, server-filtered and paginated.
  app.get("/dashboard/activity", async (request, reply) => {
    if (!authorizePage(request, reply, "/dashboard/activity")) return reply;
    const query = request.query as Record<string, unknown>;
    const page = Math.max(1, Number.parseInt(typeof query.page === "string" ? query.page : "1", 10) || 1);
    const search = typeof query.q === "string" ? query.q.trim().slice(0, 200) : undefined;
    const direction =
      query.direction === "sent" || query.direction === "received" || query.direction === "manual"
        ? query.direction
        : undefined;
    const sender = typeof query.sender === "string" && query.sender.includes("@") ? query.sender : undefined;
    const from = typeof query.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(query.from) ? query.from : undefined;
    const to = typeof query.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(query.to) ? query.to : undefined;
    // Validated against the intent set so the filter can only ever be one of Bruno's.
    const intent = typeof query.intent === "string" && isReplyIntent(query.intent) ? query.intent : undefined;
    const [shell, result, summary, checkpoints, campaignsResult] = await Promise.all([
      loadShellContext("activity", "Message activity", true),
      listCrmMessagesPage({
        page,
        pageSize: 50,
        search,
        direction,
        eaccount: sender,
        from: from ? `${from}T00:00:00-06:00` : undefined,
        to: to ? `${to}T23:59:59.999-06:00` : undefined,
        intent
      }),
      getCrmMessageSummary(),
      listSyncCheckpoints(),
      listInstantlyCampaigns({ limit: 100 }).catch(() => [])
    ]);
    const campaignNames = new Map(campaignsResult.map((campaign) => [campaign.id, campaign.name]));
    const messageSync = checkpoints.find((checkpoint) => checkpoint.stream === "crm.messages.incremental");
    return reply.type("text/html").send(
      renderShell(
        shell,
        renderActivityPage(
          {
            messages: result.messages.map((message) => ({
              id: message.provider_email_id,
              direction: message.direction,
              at: message.timestamp_email ?? message.provider_created_at ?? message.synced_at,
              leadEmail: message.lead_email ?? undefined,
              campaignName: message.campaign_id ? campaignNames.get(message.campaign_id) ?? message.campaign_id : undefined,
              sender: message.eaccount ?? undefined,
              step: message.step ?? undefined,
              variant: message.variant ?? undefined,
              subject: message.subject ?? undefined,
              preview: message.content_preview ?? undefined,
              bodyText: message.body_text ?? undefined,
              brunoIntent: message.bruno_intent ?? undefined,
              brunoReason: message.bruno_reason ?? undefined,
              brunoReturnDate: message.bruno_return_date
                ? message.bruno_return_date.toISOString().slice(0, 10)
                : undefined
            })),
            total: result.total,
            page: result.page,
            pageSize: result.pageSize,
            search,
            direction,
            sender,
            from,
            to,
            intent,
            summary: {
              total: summary.total,
              sent: summary.sent,
              received: summary.received,
              manual: summary.manual,
              leads: summary.leads,
              senders: summary.senders.map((item) => item.email),
              intents: summary.intents
            },
            syncLabel: messageSync?.cursor
              ? `backfill running · ${messageSync.records_synced.toLocaleString("en-US")} imported`
              : messageSync?.last_success_at
                ? `synced ${agoLabel(minutesSince(messageSync.last_success_at))}`
              : messageSync?.status === "running"
                ? "backfill running"
                : "waiting for first sync"
          },
          shell.generatedAt
        )
      )
    );
  });

  // Learning — proposed lessons remain inert until the owner activates them.
  app.get("/dashboard/learning", async (request, reply) => {
    if (!authorizePage(request, reply, "/dashboard/learning")) return reply;
    const [shell, lessons] = await Promise.all([
      loadShellContext("learning", "Learning", true),
      listLessons({ limit: 200 })
    ]);
    return reply.type("text/html").send(
      renderShell(
        shell,
        renderLearningPage(
          lessons.map((lesson) => ({
            id: lesson.id,
            kind: lesson.kind,
            lesson: lesson.lesson,
            evidence: lesson.evidence,
            confidence: lesson.confidence,
            status: lesson.status,
            sourceCount: lesson.source_approval_ids.length,
            proposedBy: lesson.proposed_by,
            approvedBy: lesson.approved_by ?? undefined,
            createdAt: lesson.created_at
          })),
          shell.generatedAt
        )
      )
    );
  });

  // Search — Bruno's records + Instantly's lead database
  app.get("/dashboard/search", async (request, reply) => {
    if (!authorizePage(request, reply, "/dashboard/search")) return reply;
    const qRaw = (request.query as Record<string, unknown>)?.q;
    const q = typeof qRaw === "string" ? qRaw.trim() : "";
    if (q.length < 2) return reply.redirect("/dashboard/leads", 302);

    const [shell, local, pulse, mirror] = await Promise.all([
      loadShellContext("leads", "Search", false),
      searchLeadsLocal(q),
      loadCampaignPulse(),
      listCrmLeadsPage({ search: q, pageSize: 50 })
    ]);

    const results = new Map<string, SearchResultRow>();
    for (const lead of mirror.leads) {
      results.set(lead.email.toLowerCase(), {
        email: lead.email,
        name: [lead.first_name, lead.last_name].filter(Boolean).join(" ") || undefined,
        company: lead.company_name ?? undefined,
        detail:
          [lead.job_title, lead.custom_fields.persona, leadStatusLabel(lead.status ?? undefined), interestStatusLabel(lead.interest_status ?? undefined)]
            .filter(Boolean)
            .join(" · ") || "in synchronized CRM"
      });
    }
    for (const row of local) {
      const existing = results.get(row.email);
      results.set(row.email, {
        email: row.email,
        name: existing?.name,
        company: existing?.company ?? row.company_name ?? undefined,
        detail: existing ? `${existing.detail} · last reply read as ${row.last_intent ?? "?"}` : `last reply read as ${row.last_intent ?? "?"}`,
        pendingDraft: row.pending_draft
      });
    }
    try {
      const remote = await listLeadRecordsPage({ campaignId: pulse?.campaignId, search: q, limit: 10 });
      for (const lead of remote.leads) {
        const key = lead.email.toLowerCase();
        if (results.has(key)) continue;
        results.set(key, {
          email: key,
          name: [lead.firstName, lead.lastName].filter(Boolean).join(" ") || undefined,
          company: lead.companyName,
          detail: [leadStatusLabel(lead.status), interestStatusLabel(lead.interestStatus)].filter(Boolean).join(" · ") || "in the lead database"
        });
      }
    } catch {
      // Instantly search unavailable — local results still render.
    }

    return reply.type("text/html").send(renderShell(shell, renderSearchPage(q, [...results.values()].slice(0, 20))));
  });

  // ————— Lead pipeline write-back —————

  app.post("/dashboard/api/lead/interest", async (request, reply) => {
    if (!isAuthorized(request)) return reply.code(401).send({ error: "not authorized" });
    const parsed = z
      .object({ email: z.string().email(), status: z.number().int().min(-3).max(4) })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "email and status are required" });

    const pulse = await loadCampaignPulse();
    const before = await getCrmLeadByEmail(parsed.data.email).catch(() => undefined);
    try {
      await setLeadInterest({
        email: parsed.data.email,
        interestValue: parsed.data.status,
        campaignId: pulse?.campaignId
      });
    } catch (error) {
      request.log.error({ err: error }, "lead interest update failed");
      return reply.code(502).send({ error: "Instantly rejected the update" });
    }
    await recordAgentAction({
      action: "lead.interest_status",
      targetType: "lead",
      targetId: parsed.data.email.toLowerCase(),
      actor: "dashboard",
      reason: "owner-updated pipeline status",
      beforeState: { interestStatus: before?.interest_status ?? null },
      afterState: { interestStatus: parsed.data.status }
    });
    await deleteCachedValue(`lead-rec:${parsed.data.email.toLowerCase()}`);
    await deleteCachedValue("crm:leads");
    return reply.send({ ok: true });
  });

  // ————— Approval-gated learning actions —————

  app.post("/dashboard/api/lessons", async (request, reply) => {
    if (!isAuthorized(request)) return reply.code(401).send({ error: "not authorized" });
    const parsed = z
      .object({
        kind: z.enum(["preference", "copy", "objection", "targeting", "process"]),
        lesson: z.string().trim().min(5).max(1000)
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "kind and lesson are required" });
    const result = await createLesson({
      kind: parsed.data.kind as LessonKind,
      lesson: parsed.data.lesson,
      evidence: [{ source: "owner_dashboard", at: new Date().toISOString() }],
      confidence: 1,
      status: "proposed",
      proposedBy: "owner"
    });
    await recordAgentAction({
      action: "lesson.propose",
      targetType: "lesson",
      targetId: result.lesson.id,
      actor: "dashboard",
      reason: "owner-proposed guidance",
      afterState: result.lesson
    });
    return reply.send({ ok: true, lesson: result.lesson, created: result.created });
  });

  app.post("/dashboard/api/lessons/:id/status", async (request, reply) => {
    if (!isAuthorized(request)) return reply.code(401).send({ error: "not authorized" });
    const { id } = request.params as { id: string };
    const parsed = z
      .object({
        status: z.enum(["active", "rejected", "retired"]),
        confirmed: z.literal(true)
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "an explicitly confirmed status is required" });
    try {
      const lesson = await setLessonStatus({
        id,
        status: parsed.data.status as LessonStatus,
        actor: "dashboard-owner"
      });
      await recordAgentAction({
        action: `lesson.${parsed.data.status}`,
        targetType: "lesson",
        targetId: id,
        actor: "dashboard",
        reason: "owner-confirmed learning review",
        afterState: lesson
      });
      return reply.send({ ok: true, lesson });
    } catch (error) {
      const message = error instanceof Error ? error.message : "lesson update failed";
      return reply.code(message === "Lesson not found" ? 404 : 500).send({ error: message });
    }
  });

  // ————— Confirmed, audited campaign controls —————

  app.post("/dashboard/api/campaigns/:id/action", async (request, reply) => {
    if (!isAuthorized(request)) return reply.code(401).send({ error: "not authorized" });
    const { id } = request.params as { id: string };
    const parsed = z
      .object({
        action: z.enum(["pause", "resume", "daily_limit"]),
        reason: z.string().trim().min(3).max(500),
        confirmed: z.literal(true),
        dailyLimit: z.number().int().min(1).max(500).optional()
      })
      .superRefine((value, context) => {
        if (value.action === "daily_limit" && value.dailyLimit === undefined) {
          context.addIssue({ code: "custom", message: "dailyLimit is required", path: ["dailyLimit"] });
        }
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "a confirmed action and audit reason are required" });

    let before;
    try {
      before = await getInstantlyCampaign(id);
    } catch {
      return reply.code(404).send({ error: "campaign not found" });
    }
    if (!KINTA_PERSONA_CAMPAIGNS.some((campaign) => campaign.name === before.name)) {
      return reply.code(403).send({ error: "controls are limited to the five managed Kinta persona campaigns" });
    }

    try {
      const providerResponse =
        parsed.data.action === "pause"
          ? await pauseInstantlyCampaign(id)
          : parsed.data.action === "resume"
            ? await activateInstantlyCampaign(id)
            : await patchInstantlyCampaign(id, {
                daily_limit: parsed.data.dailyLimit,
                daily_max_leads: parsed.data.dailyLimit
              });
      const after = await getInstantlyCampaign(id).catch(() => providerResponse);
      await recordAgentAction({
        action: `campaign.${parsed.data.action}`,
        targetType: "campaign",
        targetId: id,
        actor: "dashboard",
        reason: parsed.data.reason,
        beforeState: before,
        afterState: after,
        providerResponse
      });
      await deleteCachedValue("instantly:pulse:v2");
      return reply.send({ ok: true, campaign: after });
    } catch (error) {
      await recordAgentAction({
        action: `campaign.${parsed.data.action}`,
        targetType: "campaign",
        targetId: id,
        actor: "dashboard",
        reason: parsed.data.reason,
        beforeState: before,
        status: "failed",
        providerResponse: { error: error instanceof Error ? error.message : String(error) }
      });
      request.log.error({ err: error, campaignId: id }, "campaign control failed");
      return reply.code(502).send({ error: "Instantly rejected the change; no local state was changed" });
    }
  });

  // ————— Agent chat API —————

  app.post("/dashboard/api/chat", async (request, reply) => {
    if (!isAuthorized(request)) return reply.code(401).send({ error: "not authorized" });

    const parsed = z
      .object({ message: z.string().min(1).max(4000), chatId: z.string().regex(CHAT_ID_PATTERN).default("console") })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "message is required" });

    const threadKey = threadKeyFor(parsed.data.chatId);
    const message = parsed.data.message.trim();
    await appendConversationTurn(threadKey, "user", message);

    try {
      let history;
      if (parsed.data.chatId === "updates") {
        // Channel replies keep Bruno's own feed as context (user-first API rule
        // satisfied with a synthetic opener).
        history = await loadChannelConversation(threadKey, 30);
        if (history[0]?.role === "assistant") {
          history.unshift({ role: "user", content: "[Opening Bruno's updates feed — the assistant posts below are your own proactive updates.]" });
        }
      } else {
        history = await loadConversation(threadKey, 30);
      }
      const result = await runOutboundAgent(history);
      await appendConversationTurn(threadKey, "assistant", result.text);
      return reply.send({ text: result.text, toolCalls: result.toolCalls });
    } catch (error) {
      request.log.error({ err: error }, "dashboard chat: agent run failed");
      return reply.code(502).send({ error: "The agent hit an error answering that — try again." });
    }
  });

  // ————— Draft actions —————

  app.post("/dashboard/api/drafts/:id/approve", async (request, reply) => {
    if (!isAuthorized(request)) return reply.code(401).send({ error: "not authorized" });

    const { id } = request.params as { id: string };
    const parsed = approveBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "reply body is required" });

    const draft = await getDraftWithContext(id);
    if (!draft) return reply.code(404).send({ error: "draft not found" });
    if (draft.status !== "drafted") return reply.code(409).send({ error: `draft is already ${draft.status}` });

    const context = extractSendContext(draft.event_payload);
    if (!context.replyToUuid || !context.eaccount) {
      return reply.code(422).send({ error: "missing Instantly message reference — send manually from Instantly" });
    }

    const finalSubject = defaultSubject(parsed.data.subject ?? null, context.originalSubject);
    const finalBody = parsed.data.body.trim();
    const edited = finalBody !== draft.body.trim() || finalSubject !== defaultSubject(draft.subject, context.originalSubject);

    const claimed = await claimDraftForSend(id);
    if (!claimed) return reply.code(409).send({ error: "draft was already handled" });

    try {
      await sendReplyEmail({
        replyToUuid: context.replyToUuid,
        eaccount: context.eaccount,
        subject: finalSubject,
        bodyText: finalBody
      });
    } catch (error) {
      await releaseDraftClaim(id);
      request.log.error({ err: error, draftId: id }, "dashboard approve: Instantly send failed");
      return reply.code(502).send({ error: "Instantly rejected the send — draft returned to the queue" });
    }

    await markDraftSent(id);
    // Bruno's original stays on the draft; the human's final version goes on the
    // approval row (final_subject/final_body) — the edit diff feeds Phase C learning.
    await recordApproval({
      draftId: id,
      action: edited ? "edited" : "approved",
      notes: edited ? "edited on dashboard before send" : undefined,
      finalSubject,
      finalBody
    });
    return reply.send({ ok: true });
  });

  app.post("/dashboard/api/drafts/:id/reject", async (request, reply) => {
    if (!isAuthorized(request)) return reply.code(401).send({ error: "not authorized" });

    const { id } = request.params as { id: string };
    const rejected = await rejectDraft(id);
    if (!rejected) return reply.code(409).send({ error: "draft was already handled" });

    await recordApproval({ draftId: id, action: "rejected" });
    return reply.send({ ok: true });
  });

  // ————— Operations actions —————

  app.post("/dashboard/api/retargets/:id/cancel", async (request, reply) => {
    if (!isAuthorized(request)) return reply.code(401).send({ error: "not authorized" });
    const { id } = request.params as { id: string };
    await cancelRetargetById(id, "cancelled from dashboard");
    return reply.send({ ok: true });
  });

  app.post("/dashboard/api/ops/retry", async (request, reply) => {
    if (!isAuthorized(request)) return reply.code(401).send({ error: "not authorized" });
    const parsed = z.object({ name: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "job name is required" });
    const retried = await retryLatestFailedJob(parsed.data.name);
    return reply.send({ ok: true, retried });
  });

  app.post("/dashboard/api/ops/clear", async (request, reply) => {
    if (!isAuthorized(request)) return reply.code(401).send({ error: "not authorized" });
    const parsed = z.object({ name: z.string().min(1).optional() }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "invalid request" });
    const cleared = await clearFailedJobs(parsed.data.name);
    return reply.send({ ok: true, cleared });
  });

  // ————— Kill switch —————

  app.post("/dashboard/api/agent/pause", async (request, reply) => {
    if (!isAuthorized(request)) return reply.code(401).send({ error: "not authorized" });

    const parsed = z
      .object({
        paused: z.boolean(),
        reason: z.string().trim().min(3).max(500),
        confirmed: z.literal(true)
      })
      .safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "a confirmed pause state and audit reason are required" });

    const before = await isAgentPaused();
    await setAgentPaused(parsed.data.paused);
    await recordAgentAction({
      action: parsed.data.paused ? "agent.pause" : "agent.resume",
      targetType: "agent",
      targetId: "bruno",
      actor: "dashboard",
      reason: parsed.data.reason,
      beforeState: { paused: before },
      afterState: { paused: parsed.data.paused }
    });
    return reply.send({ ok: true, paused: parsed.data.paused });
  });
}
