// Page bodies for the console shell. Data models are assembled in routes.ts;
// these functions only turn them into HTML (everything dynamic escaped).

import type { CrmLeadView } from "../db/crm.js";
import { leadStatusLabel } from "../integrations/instantly.js";
import { escapeHtml, intentBadge, relativeTime, renderChatTurns, whoLabel, SEND_ICON, type ChatTurn } from "./ui.js";

const INTENT_ORDER = ["positive", "question", "objection", "not_now", "negative", "unsubscribe", "unclear"];

// ————— Live Instantly views (shared) —————

export interface EngagementView {
  openCount: number;
  clickCount: number;
  replyCount: number;
  status?: number;
  lastContactAt?: string;
  lastStepId?: string;
  lastStepFrom?: string;
}

export interface PulseView {
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

function ratePercent(numerator: number, denominator: number) {
  if (denominator <= 0) return undefined;
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

/** "email 2 · variant B" from Instantly's stepID format "0_2_1". */
function stepLabel(stepId?: string) {
  if (!stepId) return undefined;
  const parts = stepId.split("_");
  if (parts.length < 2) return undefined;
  const step = parts[1];
  const variant = parts.length > 2 ? Number(parts[2]) : undefined;
  const variantLabel = variant !== undefined && !Number.isNaN(variant) ? ` · variant ${String.fromCharCode(65 + variant)}` : "";
  return `email ${step}${variantLabel}`;
}

export function renderPulseStrip(pulse: PulseView) {
  const openRate = ratePercent(pulse.opensUnique, pulse.sent);
  const replyRate = ratePercent(pulse.repliesUnique, pulse.contacted);
  const items: string[] = [
    `<span class="pulse-item">campaign <strong>${escapeHtml(pulse.statusLabel)}</strong></span>`,
    `<span class="pulse-item"><strong>${pulse.sent}</strong> sent</span>`,
    pulse.openTracking === false
      ? `<span class="pulse-item pulse-dim">opens n/a (tracking off)</span>`
      : `<span class="pulse-item"><strong>${pulse.opensUnique}</strong> opens${openRate ? ` (${openRate})` : ""}</span>`,
    pulse.linkTracking === false
      ? `<span class="pulse-item pulse-dim">clicks n/a (tracking off)</span>`
      : `<span class="pulse-item"><strong>${pulse.clicks}</strong> clicks</span>`,
    `<span class="pulse-item"><strong>${pulse.repliesUnique}</strong> replies${replyRate ? ` (${replyRate})` : ""}</span>`,
    `<span class="pulse-item"><strong>${pulse.bounces}</strong> bounced</span>`
  ];
  if (pulse.leadCount !== undefined) {
    items.push(`<span class="pulse-item"><strong>${pulse.leadCount}${pulse.leadCountCapped ? "+" : ""}</strong> leads</span>`);
  }
  if (pulse.dailyLimit !== undefined) {
    items.push(`<span class="pulse-item">limit <strong>${pulse.dailyLimit}</strong>/day</span>`);
  }
  return `
  <section class="pulse">
    <span class="pulse-label">live · instantly</span>
    ${items.join("\n")}
  </section>`;
}

function engagementChips(engagement: EngagementView | undefined, now: Date) {
  if (!engagement) return "";
  const chips: string[] = [];
  if (engagement.openCount > 0) chips.push(`opened ${engagement.openCount}×`);
  if (engagement.clickCount > 0) chips.push(`clicked ${engagement.clickCount}×`);
  const step = stepLabel(engagement.lastStepId);
  if (step) chips.push(`last got ${step}`);
  if (engagement.lastStepFrom) chips.push(`from ${engagement.lastStepFrom}`);
  if (engagement.lastContactAt) chips.push(`last touch ${relativeTime(engagement.lastContactAt, now)}`);
  const status = leadStatusLabel(engagement.status);
  if (status) chips.push(status);
  if (chips.length === 0) return "";
  return `<div class="eng">${chips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join("")}</div>`;
}

// ————— Bruno (home: briefing + chat) —————

export interface BriefingModel {
  agentPaused: boolean;
  pendingCount: number;
  hottestWho?: string;
  needsReadCount: number;
  replies24h: Array<{ intent: string; count: number }>;
  sendsYesterday?: number;
  failedJobs: number;
  lastPollAgo?: string;
  campaignStatus?: string;
  campaignSent?: number;
  dailyLimit?: number;
}

function briefingRows(b: BriefingModel) {
  const rows: string[] = [];

  if (b.agentPaused) {
    rows.push(`<span class="b-flag b-warn">paused</span> Bruno is paused — replies aren't being processed. Resume him from the sidebar.`);
  }
  if (b.pendingCount > 0) {
    rows.push(
      `<span class="b-flag b-hot">act</span> <strong>${b.pendingCount} repl${b.pendingCount === 1 ? "y" : "ies"} waiting on you</strong>${
        b.hottestWho ? ` — hottest: ${escapeHtml(b.hottestWho)}` : ""
      } <a href="/dashboard/inbox">open Inbox →</a>`
    );
  }
  if (b.needsReadCount > 0) {
    rows.push(
      `<span class="b-flag">read</span> ${b.needsReadCount} repl${b.needsReadCount === 1 ? "y" : "ies"} Bruno couldn't classify — worth a human glance. <a href="/dashboard/inbox">Inbox →</a>`
    );
  }
  const totalNew = b.replies24h.reduce((sum, r) => sum + r.count, 0);
  if (totalNew > 0) {
    const parts = b.replies24h
      .slice()
      .sort((a, z) => INTENT_ORDER.indexOf(a.intent) - INTENT_ORDER.indexOf(z.intent))
      .map((r) => `${r.count} ${r.intent.replace("_", " ")}`);
    rows.push(`<span class="b-flag">new</span> ${totalNew} new repl${totalNew === 1 ? "y" : "ies"} in the last 24h: ${parts.join(", ")}.`);
  }
  if (b.sendsYesterday !== undefined && !(b.sendsYesterday === 0 && b.campaignStatus === "paused")) {
    rows.push(
      `<span class="b-flag">sent</span> ${b.sendsYesterday} campaign email${b.sendsYesterday === 1 ? "" : "s"} went out yesterday (warmup not counted). <a href="/dashboard/campaign">Campaign →</a>`
    );
  }
  if (b.campaignStatus) {
    rows.push(
      `<span class="b-flag">camp</span> Campaign is <strong>${escapeHtml(b.campaignStatus)}</strong>${
        b.campaignSent !== undefined ? ` — ${b.campaignSent} sent lifetime` : ""
      }${b.dailyLimit !== undefined ? `, limit ${b.dailyLimit}/day` : ""}. <a href="/dashboard/campaign">Campaign →</a>`
    );
  }
  if (b.failedJobs > 0) {
    rows.push(`<span class="b-flag b-warn">check</span> ${b.failedJobs} background task${b.failedJobs === 1 ? "" : "s"} failed. <a href="/dashboard/system">System →</a>`);
  }
  if (rows.length === 0 || (!b.agentPaused && b.failedJobs === 0)) {
    rows.push(
      `<span class="b-flag b-ok">ok</span> Everything running normally${b.lastPollAgo ? ` — replies last checked ${b.lastPollAgo}` : ""}.`
    );
  }
  return rows;
}

export function renderBrunoPage(
  turns: ChatTurn[],
  briefing: BriefingModel,
  chatId: string,
  modelLabel: string,
  mode: "chat" | "channel" = "chat"
) {
  const welcome =
    mode === "channel"
      ? `
    <div class="chat-welcome">
      <div class="bruno-mark">✳</div>
      <h2># updates</h2>
      <p>Bruno posts here on his own — the morning digest, alerts the minute they fire, weekly analytics.</p>
      <p class="hint muted">Nothing yet. The first digest lands tomorrow morning — and you can reply under any update.</p>
    </div>`
      : `
    <div class="chat-welcome">
      <div class="bruno-mark">✳</div>
      <h2>Bruno</h2>
      <p>Campaign, replies, drafts — he's on it. Ask him anything.</p>
      <p class="hint muted">Type below · <span class="mono">/</span> for commands</p>
      <div class="suggestions">
        <button class="suggestion">How is the campaign doing?</button>
        <button class="suggestion">What's our inbox health?</button>
        <button class="suggestion">Any replies this week?</button>
        <button class="suggestion">How many leads are loaded?</button>
      </div>
    </div>`;
  const pendingChip =
    briefing.pendingCount > 0
      ? `<a href="/dashboard/inbox">${briefing.pendingCount} waiting → Inbox</a>`
      : `<span>kinta · outbound</span>`;
  const dateLabel = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  const needsYou = briefing.pendingCount + briefing.needsReadCount;
  const todayLabel =
    needsYou > 0 ? `${needsYou} need${needsYou === 1 ? "s" : ""} you` : briefing.failedJobs > 0 ? "check system" : "all clear";
  return `
  <main class="main-chat reveal">
    <div class="today-row">
      <button class="today-btn" id="today-btn" type="button">
        <span class="t-dot${needsYou > 0 || briefing.failedJobs > 0 ? " hot" : ""}"></span>
        Today · ${escapeHtml(todayLabel)} ▾
      </button>
      <div class="today-panel" id="today-panel" hidden>
        <div class="briefing-title mono">Today · ${dateLabel}</div>
        ${briefingRows(briefing)
          .map((row) => `<div class="briefing-row">${row}</div>`)
          .join("\n")}
      </div>
    </div>
    <div class="chat" data-chat data-chat-id="${escapeHtml(chatId)}">
      <div class="chat-scroll" data-chat-scroll>
        ${renderChatTurns(turns, welcome)}
      </div>
      <div class="composer-wrap">
        <div class="palette" hidden></div>
        <form class="composer" data-chat-form>
          <textarea name="message" rows="2" placeholder="${mode === "channel" ? "Reply to Bruno's updates…" : "Message Bruno… ( / for commands )"}" required></textarea>
          <button class="btn btn-send" type="submit" aria-label="Send">${SEND_ICON}</button>
        </form>
        <div class="composer-foot">
          <span><span class="live-dot${briefing.agentPaused ? " paused" : ""}"></span>${briefing.agentPaused ? "paused" : "running"}${
            briefing.lastPollAgo ? ` · replies checked ${briefing.lastPollAgo}` : ""
          } · ${escapeHtml(modelLabel)}</span>
          ${pendingChip}
        </div>
      </div>
    </div>
  </main>`;
}

// ————— Lead dossier —————

export type TimelineItem =
  | { kind: "sent"; at?: string; subject?: string; from?: string; text?: string }
  | { kind: "received"; at?: string; subject?: string; text?: string }
  | { kind: "read"; at: string; intent: string; confidence: number; reason: string; suggested?: string }
  | { kind: "decision"; at: string; action: string; notes?: string; original?: string; finalText?: string }
  | { kind: "suppression"; at: string; reason: string };

export interface LeadDossierModel {
  email: string;
  name?: string;
  company?: string;
  interestLabel?: string;
  sequenceLabel?: string;
  engagement?: EngagementView;
  customFields: Record<string, string>;
  hasPendingDraft: boolean;
  timeline: TimelineItem[];
  threadUnavailable: boolean;
}

const INTEREST_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: "interested" },
  { value: 2, label: "meeting booked" },
  { value: 3, label: "meeting completed" },
  { value: 4, label: "closed" },
  { value: -1, label: "not interested" },
  { value: -2, label: "wrong person" },
  { value: -3, label: "lost" }
];

function renderTimelineItem(item: TimelineItem, now: Date) {
  const when = item.at ? `<span class="mono muted">${relativeTime(item.at, now)}</span>` : "";
  switch (item.kind) {
    case "sent":
      return `
      <div class="tl-item">
        <span class="tl-tag tl-us">we sent</span>
        <div class="tl-body">
          <div class="tl-head"><strong>${escapeHtml(item.subject ?? "(no subject)")}</strong>${item.from ? `<span class="mono muted">from ${escapeHtml(item.from)}</span>` : ""}${when}</div>
          ${item.text ? `<details><summary class="mono muted">show email</summary><blockquote>${escapeHtml(item.text)}</blockquote></details>` : ""}
        </div>
      </div>`;
    case "received":
      return `
      <div class="tl-item">
        <span class="tl-tag tl-them">they replied</span>
        <div class="tl-body">
          <div class="tl-head"><strong>${escapeHtml(item.subject ?? "(no subject)")}</strong>${when}</div>
          ${item.text ? `<blockquote>${escapeHtml(item.text)}</blockquote>` : ""}
        </div>
      </div>`;
    case "read":
      return `
      <div class="tl-item">
        <span class="tl-tag tl-bruno">bruno read</span>
        <div class="tl-body">
          <div class="tl-head">${intentBadge(item.intent)}<span class="mono muted">${Math.round(item.confidence * 100)}%</span>${when}</div>
          <div class="tl-note">${escapeHtml(item.reason)}${item.suggested ? ` — <em>suggested: ${escapeHtml(item.suggested)}</em>` : ""}</div>
        </div>
      </div>`;
    case "decision":
      return `
      <div class="tl-item">
        <span class="tl-tag tl-human">you ${escapeHtml(item.action)}</span>
        <div class="tl-body">
          <div class="tl-head">${item.notes ? `<span class="muted">${escapeHtml(item.notes)}</span>` : ""}${when}</div>
          ${
            item.action === "edited" && item.original && item.finalText
              ? `<details><summary class="mono muted">original vs sent</summary>
                 <div class="section-label" style="margin-top:8px">Bruno's original</div><blockquote>${escapeHtml(item.original)}</blockquote>
                 <div class="section-label" style="margin-top:8px">What you sent</div><blockquote>${escapeHtml(item.finalText)}</blockquote></details>`
              : item.finalText
                ? `<details><summary class="mono muted">show sent reply</summary><blockquote>${escapeHtml(item.finalText)}</blockquote></details>`
                : ""
          }
        </div>
      </div>`;
    case "suppression":
      return `
      <div class="tl-item">
        <span class="tl-tag tl-warn">suppressed</span>
        <div class="tl-body"><div class="tl-head"><span>${escapeHtml(item.reason)} — added to do-not-contact</span>${when}</div></div>
      </div>`;
  }
}

export function renderLeadPage(m: LeadDossierModel, now: Date) {
  const who = m.name || m.company || m.email;
  const fields = Object.entries(m.customFields).slice(0, 8);
  return `
  <main class="reveal">
    <section class="card dossier-head">
      <header class="card-head">
        <div>
          <h3>${escapeHtml(who)}</h3>
          <div class="mono muted">${escapeHtml(m.email)}${m.company && m.name ? ` · ${escapeHtml(m.company)}` : ""}</div>
        </div>
        <div class="card-meta">
          ${m.interestLabel ? `<span class="badge" style="background:rgba(52,211,116,0.13);color:#4ade80">${escapeHtml(m.interestLabel)}</span>` : ""}
          ${m.sequenceLabel ? `<span class="badge" style="background:rgba(148,163,184,0.14);color:#cbd5e1">${escapeHtml(m.sequenceLabel)}</span>` : ""}
        </div>
      </header>
      ${engagementChips(m.engagement, now)}
      ${
        fields.length > 0
          ? `<div class="eng" style="margin-top:8px">${fields.map(([k, v]) => `<span>${escapeHtml(k)}: ${escapeHtml(v.slice(0, 40))}</span>`).join("")}</div>`
          : ""
      }
      <footer class="card-actions">
        ${m.hasPendingDraft ? `<a class="btn btn-approve" style="text-decoration:none" href="/dashboard/inbox">Draft waiting → Inbox</a>` : ""}
        <form class="interest-form" data-interest-form data-email="${escapeHtml(m.email)}">
          <select name="status" class="interest-select">
            <option value="">Set pipeline status…</option>
            ${INTEREST_OPTIONS.map((o) => `<option value="${o.value}"${m.interestLabel === o.label ? " selected" : ""}>${o.label}</option>`).join("")}
          </select>
          <button class="btn btn-plain" type="submit">Update</button>
          <span class="action-status mono" aria-live="polite"></span>
        </form>
      </footer>
    </section>
    <h2>Timeline</h2>
    ${m.threadUnavailable ? `<p class="muted">Email thread unavailable from Instantly right now — showing Bruno's records only.</p>` : ""}
    ${m.timeline.length === 0 ? `<p class="muted">Nothing recorded for this lead yet.</p>` : `<div class="tl">${m.timeline.map((t) => renderTimelineItem(t, now)).join("\n")}</div>`}
  </main>`;
}

// ————— Leads (CRM) —————

export interface CrmRow {
  email: string;
  name?: string;
  company?: string;
  persona?: string;
  targetRole?: string;
  interestLabel?: string;
  sequenceLabel?: string;
  opens: number;
  clicks: number;
  replies: number;
  lastContactAt?: string;
  tags: string;
  brunoIntent?: string;
  brunoReturnDate?: string;
}

export interface LeadsPageModel {
  rows: CrmRow[];
  total: number;
  page: number;
  pageSize: number;
  search?: string;
  view: CrmLeadView;
  summary: {
    total: number;
    uncontacted: number;
    contacted: number;
    noReply: number;
    away: number;
    needsRead: number;
    inSequence: number;
    replied: number;
    interested: number;
    finished: number;
    suppressed: number;
  };
  syncLabel?: string;
}

function pageHref(path: string, params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "" && value !== "all") query.set(key, String(value));
  }
  const suffix = query.toString();
  return `${path}${suffix ? `?${suffix}` : ""}`;
}

function renderPager(path: string, page: number, pageSize: number, total: number, params: Record<string, string | undefined>) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return "";
  return `<nav class="pager mono" aria-label="Pagination">
    ${page > 1 ? `<a class="btn btn-plain" href="${escapeHtml(pageHref(path, { ...params, page: page - 1 }))}">← Previous</a>` : ""}
    <span class="muted">page ${page} of ${pages}</span>
    ${page < pages ? `<a class="btn btn-plain" href="${escapeHtml(pageHref(path, { ...params, page: page + 1 }))}">Next →</a>` : ""}
  </nav>`;
}

/** Bruno's verdict for the roster, short enough for a table cell. */
function brunoReadCell(row: CrmRow, now: Date) {
  if (!row.brunoIntent) return `<span class="muted">—</span>`;
  const badge = intentBadge(row.brunoIntent);
  if (row.brunoIntent !== "out_of_office") return badge;
  return `${badge}<div class="mono muted">${escapeHtml(returnLabel(row.brunoReturnDate, now))}</div>`;
}

export function renderLeadsPage(m: LeadsPageModel, now: Date) {
  // Funnel order: who we emailed, who stayed silent, then what came back.
  //
  // "in sequence" is deliberately absent — it tests status IN (1,2) and Instantly
  // marks every imported lead active, so it returned 2,495 of 2,499 rows. As a
  // filter it was indistinguishable from "all". The predicate still works by URL
  // for anything already linking to it.
  //
  // Empty views are dropped too: a tab reading "needs read 0" costs a row of
  // chrome to say nothing. "all" and the current view always survive, so the
  // full roster stays reachable and the selected tab never vanishes underneath.
  const allTabs: Array<{ value: LeadsPageModel["view"]; label: string; count: number }> = [
    { value: "contacted", label: "contacted", count: m.summary.contacted },
    { value: "no-reply", label: "no reply", count: m.summary.noReply },
    { value: "away", label: "away", count: m.summary.away },
    { value: "needs-read", label: "needs read", count: m.summary.needsRead },
    { value: "replied", label: "replied", count: m.summary.replied },
    { value: "interested", label: "interested", count: m.summary.interested },
    { value: "finished", label: "finished", count: m.summary.finished },
    { value: "suppressed", label: "suppressed", count: m.summary.suppressed }
  ];
  const tabs = [
    { value: "all" as LeadsPageModel["view"], label: "all", count: m.summary.total },
    ...allTabs.filter((tab) => tab.count > 0 || tab.value === m.view)
  ];
  const table =
    m.rows.length === 0
      ? `<div class="empty"><p>No leads match this view yet. Bruno's synchronized CRM will fill automatically as Instantly is scanned.</p></div>`
      : `
      <div class="table-scroll">
        <table id="crm-table">
          <thead><tr><th>Lead</th><th>Persona</th><th>Bruno's read</th><th>Pipeline</th><th>Sequence</th><th class="num">Opens</th><th class="num">Clicks</th><th class="num">Replies</th><th>Last contact</th></tr></thead>
          <tbody>
            ${m.rows
              .map(
                (row) => `
                <tr data-tags="${escapeHtml(row.tags)}" data-text="${escapeHtml(`${row.name ?? ""} ${row.company ?? ""} ${row.email} ${row.persona ?? ""} ${row.targetRole ?? ""}`.toLowerCase())}">
                  <td><a class="lead-link" href="/dashboard/lead?email=${encodeURIComponent(row.email)}"><strong>${escapeHtml(row.name || row.company || row.email)}</strong></a><div class="mono muted">${escapeHtml(row.email)}${row.company && row.name ? ` · ${escapeHtml(row.company)}` : ""}</div></td>
                  <td>${row.persona ? `<span class="badge" style="background:rgba(99,102,241,0.15);color:#a5b4fc">${escapeHtml(row.persona)}</span>${row.targetRole ? `<div class="mono muted">${escapeHtml(row.targetRole)}</div>` : ""}` : `<span class="muted">—</span>`}</td>
                  <td>${brunoReadCell(row, now)}</td>
                  <td>${row.interestLabel ? `<span class="badge" style="background:rgba(52,211,116,0.13);color:#4ade80">${escapeHtml(row.interestLabel)}</span>` : `<span class="muted">—</span>`}</td>
                  <td class="mono">${escapeHtml(row.sequenceLabel ?? "—")}</td>
                  <td class="mono num">${row.opens}</td>
                  <td class="mono num">${row.clicks}</td>
                  <td class="mono num">${row.replies}</td>
                  <td class="mono">${row.lastContactAt ? relativeTime(row.lastContactAt, now) : "—"}</td>
                </tr>`
              )
              .join("\n")}
          </tbody>
        </table>
      </div>`;

  return `
  <main class="reveal">
    <section class="crm-summary">
      <div class="crm-stat"><strong>${m.summary.total.toLocaleString("en-US")}</strong><span>all synchronized</span></div>
      <div class="crm-stat"><strong>${m.summary.uncontacted.toLocaleString("en-US")}</strong><span>uncontacted</span></div>
      <div class="crm-stat"><strong>${m.summary.replied.toLocaleString("en-US")}</strong><span>replied</span></div>
      <div class="crm-stat"><strong>${m.summary.interested.toLocaleString("en-US")}</strong><span>interested</span></div>
    </section>
    <form class="crm-bar" action="/dashboard/leads" method="get">
      ${tabs
        .map(
          (tab) =>
            `<a class="crm-tab${m.view === tab.value ? " sel" : ""}" style="text-decoration:none" href="${escapeHtml(pageHref("/dashboard/leads", { view: tab.value, q: m.search }))}">${tab.label} <span class="mono muted">${tab.count}</span></a>`
        )
        .join("")}
      <input class="crm-search" name="q" type="search" value="${escapeHtml(m.search ?? "")}" placeholder="search the complete CRM…" />
      ${m.view !== "all" ? `<input type="hidden" name="view" value="${escapeHtml(m.view)}" />` : ""}
      <button class="btn btn-plain" type="submit">Search</button>
      <span class="mono muted">${m.total.toLocaleString("en-US")} match${m.total === 1 ? "" : "es"}${m.syncLabel ? ` · ${escapeHtml(m.syncLabel)}` : ""}</span>
    </form>
    ${table}
    ${renderPager("/dashboard/leads", m.page, m.pageSize, m.total, { view: m.view, q: m.search })}
  </main>`;
}

// ————— Account-wide message ledger —————

export interface ActivityMessage {
  id: string;
  direction: "sent" | "received" | "manual";
  at?: string;
  leadEmail?: string;
  campaignName?: string;
  sender?: string;
  step?: string;
  variant?: string;
  subject?: string;
  preview?: string;
  bodyText?: string;
}

export interface ActivityPageModel {
  messages: ActivityMessage[];
  total: number;
  page: number;
  pageSize: number;
  search?: string;
  direction?: "sent" | "received" | "manual";
  sender?: string;
  from?: string;
  to?: string;
  summary: { total: number; sent: number; received: number; manual: number; leads: number; senders: string[] };
  syncLabel?: string;
}

export function renderActivityPage(m: ActivityPageModel, now: Date) {
  const rows =
    m.messages.length === 0
      ? `<div class="empty"><p>No messages match these filters. The ledger fills automatically from Instantly.</p></div>`
      : `<div class="table-scroll">
          <table>
            <thead><tr><th>Direction</th><th>Lead</th><th>Subject / exact content</th><th>Sender</th><th>Sequence</th><th>When</th></tr></thead>
            <tbody>
              ${m.messages
                .map((message, index) => {
                  const key = `${index}-${message.id}`;
                  return `<tr class="ledger-row" data-ledger-row="${escapeHtml(key)}">
                    <td><span class="direction direction-${message.direction}">${message.direction}</span></td>
                    <td>${message.leadEmail ? `<a class="lead-link mono" href="/dashboard/lead?email=${encodeURIComponent(message.leadEmail)}">${escapeHtml(message.leadEmail)}</a>` : `<span class="muted">unknown</span>`}</td>
                    <td>
                      <strong>${escapeHtml(message.subject || "(no subject)")}</strong>
                      <div class="ledger-preview">${escapeHtml((message.preview || message.bodyText || "").slice(0, 180))}</div>
                    </td>
                    <td class="mono">${escapeHtml(message.sender ?? "—")}</td>
                    <td><span class="mono">${message.step ? `step ${escapeHtml(message.step)}` : "—"}${message.variant ? ` · ${escapeHtml(message.variant)}` : ""}</span>${message.campaignName ? `<div class="muted">${escapeHtml(message.campaignName)}</div>` : ""}</td>
                    <td class="mono">${message.at ? relativeTime(message.at, now) : "—"}</td>
                  </tr>
                  <tr class="ledger-detail" data-ledger-detail="${escapeHtml(key)}" hidden>
                    <td colspan="6">
                      <div class="ledger-message">${escapeHtml(message.bodyText || message.preview || "(message body unavailable)")}</div>
                    </td>
                  </tr>`;
                })
                .join("\n")}
            </tbody>
          </table>
        </div>`;

  return `<main class="reveal">
    <section class="crm-summary">
      <div class="crm-stat"><strong>${m.summary.total.toLocaleString("en-US")}</strong><span>all messages</span></div>
      <div class="crm-stat"><strong>${m.summary.sent.toLocaleString("en-US")}</strong><span>campaign sent</span></div>
      <div class="crm-stat"><strong>${m.summary.received.toLocaleString("en-US")}</strong><span>received</span></div>
      <div class="crm-stat"><strong>${m.summary.leads.toLocaleString("en-US")}</strong><span>lead threads</span></div>
    </section>
    <form class="crm-bar" action="/dashboard/activity" method="get">
      <input class="crm-search" name="q" type="search" value="${escapeHtml(m.search ?? "")}" placeholder="search email, subject, or exact message text…" />
      <select class="crm-select" name="direction">
        <option value="">all directions</option>
        ${(["sent", "received", "manual"] as const).map((value) => `<option value="${value}"${m.direction === value ? " selected" : ""}>${value}</option>`).join("")}
      </select>
      <select class="crm-select" name="sender">
        <option value="">all senders</option>
        ${m.summary.senders.map((sender) => `<option value="${escapeHtml(sender)}"${m.sender === sender ? " selected" : ""}>${escapeHtml(sender)}</option>`).join("")}
      </select>
      <input class="crm-date" type="date" name="from" value="${escapeHtml(m.from ?? "")}" title="From date" />
      <input class="crm-date" type="date" name="to" value="${escapeHtml(m.to ?? "")}" title="To date" />
      <button class="btn btn-plain" type="submit">Filter</button>
      <span class="mono muted">${m.total.toLocaleString("en-US")} match${m.total === 1 ? "" : "es"}${m.syncLabel ? ` · ${escapeHtml(m.syncLabel)}` : ""}</span>
    </form>
    ${rows}
    ${renderPager("/dashboard/activity", m.page, m.pageSize, m.total, {
      q: m.search,
      direction: m.direction,
      sender: m.sender,
      from: m.from,
      to: m.to
    })}
  </main>`;
}

// ————— Human-approved learning —————

export interface LessonView {
  id: string;
  kind: string;
  lesson: string;
  evidence: unknown;
  confidence: number;
  status: "proposed" | "active" | "rejected" | "retired";
  sourceCount: number;
  proposedBy: string;
  approvedBy?: string;
  createdAt: string;
}

export function renderLearningPage(lessons: LessonView[], now: Date) {
  const proposed = lessons.filter((lesson) => lesson.status === "proposed").length;
  const active = lessons.filter((lesson) => lesson.status === "active").length;
  const cards =
    lessons.length === 0
      ? `<div class="empty"><p>No lessons yet. Bruno reviews owner edits weekly and will propose recurring patterns here.</p></div>`
      : `<div class="lesson-grid">${lessons
          .map((lesson) => {
            const evidence =
              Array.isArray(lesson.evidence) || (lesson.evidence && typeof lesson.evidence === "object")
                ? JSON.stringify(lesson.evidence, null, 2)
                : String(lesson.evidence ?? "");
            const actions =
              lesson.status === "proposed"
                ? `<button class="btn btn-approve" data-lesson-id="${lesson.id}" data-lesson-status="active">Activate</button>
                   <button class="btn btn-reject" data-lesson-id="${lesson.id}" data-lesson-status="rejected">Reject</button>`
                : lesson.status === "active"
                  ? `<button class="btn btn-reject" data-lesson-id="${lesson.id}" data-lesson-status="retired">Retire</button>`
                  : `<button class="btn btn-plain" data-lesson-id="${lesson.id}" data-lesson-status="active">Reactivate</button>`;
            return `<article class="lesson lesson-${lesson.status}">
              <div class="lesson-head">
                <span class="badge">${escapeHtml(lesson.kind)}</span>
                <span class="mono">${escapeHtml(lesson.status)}</span>
                <span class="confidence mono">${Math.round(lesson.confidence * 100)}% confidence</span>
              </div>
              <div class="lesson-text">${escapeHtml(lesson.lesson)}</div>
              <div class="lesson-evidence">${escapeHtml(evidence || "No structured evidence attached.")}</div>
              <div class="mono muted">${lesson.sourceCount} supporting owner edit${lesson.sourceCount === 1 ? "" : "s"} · proposed by ${escapeHtml(lesson.proposedBy)} · ${relativeTime(lesson.createdAt, now)}</div>
              <div class="lesson-actions">${actions}${lesson.approvedBy ? `<span class="mono muted">approved by ${escapeHtml(lesson.approvedBy)}</span>` : ""}</div>
            </article>`;
          })
          .join("\n")}</div>`;

  return `<main class="reveal">
    <div class="status-hero ${proposed > 0 ? "status-bad" : "status-ok"}">
      <div class="status-mark">${proposed > 0 ? proposed : "✓"}</div>
      <div>
        <strong>${proposed > 0 ? `${proposed} lesson${proposed === 1 ? "" : "s"} waiting for owner review.` : "Bruno only learns approved lessons."}</strong><br/>
        <span class="muted">${active} active. Draft edits are evidence, not automatic permission: proposed rules do nothing until you activate them.</span>
      </div>
    </div>
    <h2>Add owner guidance</h2>
    <form class="control-card crm-bar" data-lesson-form>
      <select class="crm-select" name="kind">
        ${["preference", "copy", "objection", "targeting", "process"].map((kind) => `<option value="${kind}">${kind}</option>`).join("")}
      </select>
      <input class="crm-search" name="lesson" maxlength="1000" placeholder="e.g. Keep objection replies under 90 words and end with one question." required />
      <button class="btn btn-plain" type="submit">Propose lesson</button>
    </form>
    <h2>Learning memory <span class="count mono">${lessons.length}</span></h2>
    ${cards}
  </main>`;
}

// ————— Search results —————

export interface SearchResultRow {
  email: string;
  name?: string;
  company?: string;
  detail: string;
  pendingDraft?: boolean;
}

export function renderSearchPage(q: string, results: SearchResultRow[]) {
  const rows =
    results.length === 0
      ? `<p class="muted">Nothing found for “${escapeHtml(q)}” — try a partial company name or email.</p>`
      : results
          .map(
            (r) => `
            <div class="feed-row">
              <div class="feed-top">
                <a class="lead-link" href="/dashboard/lead?email=${encodeURIComponent(r.email)}"><strong>${escapeHtml(r.name || r.company || r.email)}</strong></a>
                ${r.pendingDraft ? `<span class="badge" style="background:rgba(240,78,35,0.14);color:#ff8a65">draft waiting</span>` : ""}
                <span class="mono muted">${escapeHtml(r.email)}</span>
              </div>
              <div class="feed-reason muted">${escapeHtml(r.detail)}</div>
            </div>`
          )
          .join("\n");
  return `
  <main class="reveal">
    <h2>Results for “${escapeHtml(q)}”</h2>
    ${rows}
  </main>`;
}

// ————— Inbox —————

export interface DraftCardModel {
  id: string;
  companyName?: string;
  email?: string;
  intent: string;
  confidence: number;
  reason: string;
  suggestedNextAction?: string;
  internalReason?: string;
  prospectText?: string;
  subject: string;
  body: string;
  createdAt: string;
  sendFrom?: string;
  canSend: boolean;
  engagement?: EngagementView;
}

export interface ReplyFeedModel {
  companyName?: string;
  email?: string;
  intent: string;
  reason: string;
  createdAt: string;
  prospectText?: string;
  engagement?: EngagementView;
}

export interface ActivityModel {
  action: string;
  companyName?: string;
  email?: string;
  createdAt: string;
}

const HOT_SLA_INTENTS = ["positive", "question", "objection"];

function renderDraftCard(draft: DraftCardModel, now: Date) {
  const who = whoLabel(draft.companyName, draft.email);
  const confidence = `${Math.round(draft.confidence * 100)}%`;
  const ageMinutes = Math.max(0, Math.floor((now.getTime() - new Date(draft.createdAt).getTime()) / 60000));
  const slaOver = HOT_SLA_INTENTS.includes(draft.intent) && ageMinutes > 60;
  const sendNote = draft.canSend
    ? `will send from <strong>${escapeHtml(draft.sendFrom ?? "")}</strong>`
    : `<span class="warn-text">can't auto-send — the reply is missing its Instantly message reference; copy the draft and send it from Instantly</span>`;

  return `
  <article class="card" data-draft-id="${escapeHtml(draft.id)}" data-who="${escapeHtml(who)}">
    <header class="card-head">
      <div>
        <h3>${draft.email ? `<a class="lead-link" href="/dashboard/lead?email=${encodeURIComponent(draft.email)}">${escapeHtml(who)}</a>` : escapeHtml(who)}</h3>
        ${draft.email ? `<div class="mono muted">${escapeHtml(draft.email)}</div>` : ""}
      </div>
      <div class="card-meta">
        ${intentBadge(draft.intent)}
        <span class="mono muted">${confidence}</span>
        <span class="mono ${slaOver ? "sla-over" : "muted"}">${relativeTime(draft.createdAt, now)}${slaOver ? " · ⏰ over the 1-hour mark" : ""}</span>
      </div>
    </header>
    ${engagementChips(draft.engagement, now)}
    ${
      draft.prospectText
        ? `<div class="prospect"><div class="section-label">They wrote</div><blockquote>${escapeHtml(draft.prospectText)}</blockquote></div>`
        : ""
    }
    <div class="agent-note"><span class="section-label">Bruno's read</span> ${escapeHtml(draft.reason)}${
      draft.internalReason ? ` · <em>${escapeHtml(draft.internalReason)}</em>` : ""
    }</div>
    ${draft.suggestedNextAction ? `<div class="agent-note"><span class="section-label">Bruno suggests</span> ${escapeHtml(draft.suggestedNextAction)}</div>` : ""}
    <label class="field">
      <span class="section-label">Subject</span>
      <input type="text" name="subject" value="${escapeHtml(draft.subject)}" />
    </label>
    <label class="field">
      <span class="section-label">Bruno's draft — edit freely, then approve</span>
      <textarea name="body" rows="9">${escapeHtml(draft.body)}</textarea>
    </label>
    <footer class="card-actions">
      <button class="btn btn-approve" data-action="approve" ${draft.canSend ? "" : 'data-locked="1" disabled'}>Approve &amp; send</button>
      <button class="btn btn-reject" data-action="reject">Reject</button>
      <span class="send-note mono">${sendNote}</span>
      <span class="action-status mono" aria-live="polite"></span>
    </footer>
  </article>`;
}

function handledDescription(intent: string) {
  switch (intent) {
    case "negative":
      return "not interested — Bruno stopped their emails and added them to the do-not-contact list";
    case "unsubscribe":
      return "asked to unsubscribe — honored and added to the do-not-contact list";
    case "not_now":
      return "not right now — logged to revisit in a couple of months";
    default:
      return "logged";
  }
}

export interface AwayModel {
  companyName?: string;
  email: string;
  returnDate?: string;
  alternateContact?: string;
  prospectText?: string;
  createdAt: string;
  retargetId?: string;
  retargetAt?: string;
}

/** "back Thursday" reads better than a bare date when the return is imminent. */
function returnLabel(returnDate: string | undefined, now: Date) {
  if (!returnDate) return "no date given";
  const then = new Date(`${returnDate}T00:00:00.000Z`);
  if (Number.isNaN(then.getTime())) return "no date given";
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const days = Math.round((then.getTime() - today.getTime()) / 86400000);
  const weekday = then.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  if (days < 0) return `was back ${weekday}`;
  if (days === 0) return "back today";
  if (days === 1) return "back tomorrow";
  if (days <= 6) return `back ${weekday}`;
  return `back ${then.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
}

function renderAwaySection(away: AwayModel[], now: Date) {
  if (away.length === 0) return "";
  const scheduled = away.filter((row) => row.retargetId).length;
  return `
    <h2>Away <span class="count mono">${away.length}</span></h2>
    <p class="muted" style="margin-top:-4px">Auto-replies — nobody made a decision here, so their sequence keeps running. ${
      scheduled > 0
        ? `${scheduled} follow-up${scheduled === 1 ? "" : "s"} queued for when they're back; the draft lands in "Waiting on you" that morning.`
        : `None have a return date, so nothing is queued.`
    }</p>
    ${away
      .map(
        (row) => `
        <div class="feed-row">
          <div class="feed-top">
            <strong>${escapeHtml(whoLabel(row.companyName, row.email))}</strong>
            <span class="badge" style="background:rgba(56,189,248,0.14);color:#7dd3fc">${escapeHtml(returnLabel(row.returnDate, now))}</span>
            ${
              row.retargetId
                ? `<span class="mono muted">follow-up queued</span>`
                : `<span class="mono muted">no follow-up</span>`
            }
            <span class="mono muted">${relativeTime(row.createdAt, now)}</span>
          </div>
          <div class="feed-reason muted">${escapeHtml(row.email)}${
            row.alternateContact ? ` · while away: ${escapeHtml(row.alternateContact)}` : ""
          }</div>
          ${
            row.retargetId
              ? `<div class="feed-reason"><form class="interest-form" data-cancel-retarget data-retarget="${escapeHtml(row.retargetId)}">
                   <button class="btn btn-plain" type="submit">Cancel follow-up</button>
                   <span class="action-status mono" aria-live="polite"></span>
                 </form></div>`
              : ""
          }
        </div>`
      )
      .join("\n")}`;
}

export function renderInboxPage(
  drafts: DraftCardModel[],
  needsRead: ReplyFeedModel[],
  handled: ReplyFeedModel[],
  activity: ActivityModel[],
  now: Date,
  pulse?: PulseView,
  away: AwayModel[] = []
) {
  const cards = drafts.map((draft) => renderDraftCard(draft, now)).join("\n");
  const empty = `
    <div class="empty">
      <div class="empty-mark">✓</div>
      <p>No one is waiting on you. New replies show up here within ~5 minutes of arriving.</p>
    </div>`;

  const needsReadHtml =
    needsRead.length === 0
      ? ""
      : `
      <h2>Needs your read <span class="count mono">${needsRead.length}</span></h2>
      <p class="muted" style="margin-top:-4px">Bruno wasn't confident what these mean — give them a quick human glance; if one is warm, reply from Instantly directly.</p>
      ${needsRead
        .map(
          (row) => `
          <article class="card">
            <header class="card-head">
              <div><h3>${escapeHtml(whoLabel(row.companyName, row.email))}</h3>
              ${row.email ? `<div class="mono muted">${escapeHtml(row.email)}</div>` : ""}</div>
              <div class="card-meta">${intentBadge(row.intent)}<span class="mono muted">${relativeTime(row.createdAt, now)}</span></div>
            </header>
            ${engagementChips(row.engagement, now)}
            ${row.prospectText ? `<div class="prospect"><div class="section-label">They wrote</div><blockquote>${escapeHtml(row.prospectText)}</blockquote></div>` : ""}
            <div class="agent-note"><span class="section-label">Bruno's read</span> ${escapeHtml(row.reason)}</div>
          </article>`
        )
        .join("\n")}`;

  const handledHtml =
    handled.length === 0
      ? `<p class="muted">Nothing yet — negative and unsubscribe replies will be handled automatically and listed here.</p>`
      : handled
          .map(
            (row) => `
            <div class="feed-row">
              <div class="feed-top">
                <strong>${escapeHtml(whoLabel(row.companyName, row.email))}</strong>
                ${intentBadge(row.intent)}
                <span class="mono muted">${relativeTime(row.createdAt, now)}</span>
              </div>
              <div class="feed-reason muted">${escapeHtml(handledDescription(row.intent))}</div>
            </div>`
          )
          .join("\n");

  const log =
    activity.length === 0
      ? `<p class="muted">No approvals or rejections yet.</p>`
      : activity
          .map(
            (row) => `
            <div class="log-row mono">
              <span class="log-action log-${escapeHtml(row.action)}">${escapeHtml(row.action)}</span>
              <span>${escapeHtml(whoLabel(row.companyName, row.email))}</span>
              <span class="muted">${relativeTime(row.createdAt, now)}</span>
            </div>`
          )
          .join("\n");

  return `
  <main class="reveal">
    ${pulse ? renderPulseStrip(pulse) : ""}
    <h2>Waiting on you <span class="count mono" id="pending-count">${drafts.length}</span></h2>
    ${drafts.length > 0 ? cards : empty}
    ${needsReadHtml}
    ${renderAwaySection(away, now)}
    <h2>Handled for you · 7d</h2>
    ${handledHtml}
    <h2>Recent actions</h2>
    ${log}
  </main>`;
}

// ————— Campaign —————

export interface CampaignModel {
  contacted7d: number;
  sends7d: number;
  replies7d: number;
  bounces7d: number;
  positive7d: number;
  daily: Array<{ date: string; contacted: number; sends: number; replies: number; bounces: number }>;
  pulse?: PulseView;
  profitability: Array<{ persona: string; currency: string; outcomes: number; revenue: number; direct_cost: number; gross_profit: number }>;
  controls: Array<{
    id: string;
    name: string;
    status: string;
    dailyLimit?: number;
    schedule?: string;
  }>;
}

function formatPercent(numerator: number, denominator: number) {
  if (denominator <= 0) return "—";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function renderLiveTiles(pulse: PulseView) {
  const replyRate = ratePercent(pulse.repliesUnique, pulse.contacted) ?? "—";
  const openValue = pulse.openTracking === false ? "off" : String(pulse.opensUnique);
  const openSub =
    pulse.openTracking === false
      ? "open tracking disabled (plain-text)"
      : ratePercent(pulse.opensUnique, pulse.sent)
        ? `${ratePercent(pulse.opensUnique, pulse.sent)} open rate`
        : "no opens recorded yet";
  const replySub =
    pulse.sent < 300
      ? "too few sends to judge vs the 3% rule"
      : `${replyRate} vs the 3% golden rule`;
  return `
    <section class="kpis">
      <div class="tile">
        <div class="tile-label">Sent · lifetime</div>
        <div class="tile-value">${pulse.sent.toLocaleString("en-US")}</div>
        <div class="tile-sub">${pulse.leadCount !== undefined ? `${pulse.leadCount}${pulse.leadCountCapped ? "+" : ""} leads loaded` : "live from Instantly"}</div>
      </div>
      <div class="tile">
        <div class="tile-label">Opens</div>
        <div class="tile-value">${openValue}</div>
        <div class="tile-sub">${openSub}</div>
      </div>
      <div class="tile">
        <div class="tile-label">Replies</div>
        <div class="tile-value">${pulse.repliesUnique}</div>
        <div class="tile-sub">${replySub}</div>
      </div>
      <div class="tile${pulse.bounces > 0 && pulse.sent > 0 && pulse.bounces / pulse.sent > 0.03 ? " tile-bad" : ""}">
        <div class="tile-label">Bounces</div>
        <div class="tile-value">${pulse.bounces}</div>
        <div class="tile-sub">${pulse.linkTracking === false ? "link tracking off" : `${pulse.clicks} link clicks`} · ${pulse.unsubscribes} unsubscribed</div>
      </div>
    </section>`;
}

function renderPersonaPerformance(m: CampaignModel) {
  if (!m.pulse || m.pulse.personas.length === 0) return "";
  const profitByPersona = new Map<string, string[]>();
  for (const row of m.profitability) {
    const values = profitByPersona.get(row.persona) ?? [];
    values.push(`${row.currency} ${row.gross_profit.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
    profitByPersona.set(row.persona, values);
  }
  const rows = m.pulse.personas.map((row) => {
    const clickRate = row.linkTracking
      ? formatPercent(row.clicks, row.sent)
      : "off";
    return `<tr>
      <td><strong>${escapeHtml(row.persona)}</strong></td>
      <td class="mono num">${row.contacted}</td>
      <td class="mono num">${row.sent}</td>
      <td class="mono num">${row.repliesUnique} · ${formatPercent(row.repliesUnique, row.contacted)}</td>
      <td class="mono num">${row.positiveReplies ?? "—"}</td>
      <td class="mono num">${row.meetings ?? "—"}</td>
      <td class="mono num">${row.opportunities}</td>
      <td class="mono num">${row.closed ?? "—"}</td>
      <td class="mono num">${clickRate}</td>
      <td class="mono num">${escapeHtml(profitByPersona.get(row.persona)?.join(" · ") ?? "not recorded")}</td>
    </tr>`;
  }).join("\n");
  return `
    <h2>Persona performance · lifetime</h2>
    <p class="muted">Reply and conversion rates use contacted leads. Profit is actual revenue minus direct cost; it is never inferred from pipeline value.</p>
    <div class="table-scroll"><table>
      <thead><tr><th>Persona</th><th class="num">Contacted</th><th class="num">Sent</th><th class="num">Replies · rate</th><th class="num">Positive</th><th class="num">Meetings</th><th class="num">Opps</th><th class="num">Closed</th><th class="num">CTR</th><th class="num">Gross profit</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function renderInboxHealthTable(pulse: PulseView) {
  if (pulse.inboxes.length === 0) return "";
  const rows = pulse.inboxes
    .map(
      (inbox) => `
      <tr>
        <td class="mono">${escapeHtml(inbox.email)}</td>
        <td class="mono num">${inbox.todaySent ?? "—"}</td>
        <td class="mono num">${inbox.last7Sent}</td>
        <td class="mono num">${Math.round(inbox.landingRate * 100)}%</td>
        <td>${inbox.landingRate >= 0.9 ? `<span class="ok-text">healthy</span>` : `<span class="warn-text">watch — landing below 90%</span>`}</td>
      </tr>`
    )
    .join("\n");
  return `
    <h2>Sending inboxes</h2>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Inbox</th><th class="num">Warmup today</th><th class="num">7d warmup</th><th class="num">Inbox landing</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

export function renderCampaignPage(m: CampaignModel) {
  const table =
    m.daily.length === 0
      ? `<p class="muted">No daily history yet — this fills in nightly once sending starts.</p>`
      : `
      <div class="table-scroll">
        <table>
          <thead><tr><th>Date</th><th class="num">Contacted</th><th class="num">Sent</th><th class="num">Replies</th><th class="num">Bounces</th></tr></thead>
          <tbody>
            ${m.daily
              .map(
                (day) => `
                <tr>
                  <td class="mono">${escapeHtml(day.date)}</td>
                  <td class="mono num">${day.contacted}</td>
                  <td class="mono num">${day.sends}</td>
                  <td class="mono num">${day.replies}</td>
                  <td class="mono num">${day.bounces}</td>
                </tr>`
              )
              .join("\n")}
          </tbody>
        </table>
      </div>`;

  const fallbackTiles = `
    <section class="kpis">
      <div class="tile">
        <div class="tile-label">Sends · 7d</div>
        <div class="tile-value">${m.sends7d.toLocaleString("en-US")}</div>
        <div class="tile-sub">${m.bounces7d.toLocaleString("en-US")} bounced</div>
      </div>
      <div class="tile">
        <div class="tile-label">Replies · 7d</div>
        <div class="tile-value">${m.replies7d.toLocaleString("en-US")}</div>
        <div class="tile-sub">${m.positive7d.toLocaleString("en-US")} positive</div>
      </div>
      <div class="tile">
        <div class="tile-label">Reply rate · 7d</div>
        <div class="tile-value">${formatPercent(m.replies7d, m.contacted7d)}</div>
        <div class="tile-sub">${m.sends7d < 300 ? "too few sends to judge yet (need 300+)" : "golden rule: scale at >3%"}</div>
      </div>
      <div class="tile">
        <div class="tile-label">Bounce rate · 7d</div>
        <div class="tile-value">${formatPercent(m.bounces7d, m.sends7d)}</div>
        <div class="tile-sub">keep under 3%</div>
      </div>
    </section>`;

  const controls =
    m.controls.length === 0
      ? `<p class="muted">Managed campaign controls are unavailable while Instantly is unreachable.</p>`
      : `<div class="control-list">${m.controls
          .map((campaign) => {
            const isLive = campaign.status === "active" || campaign.status === "running";
            return `<div class="control-row">
              <div class="control-name">
                <strong>${escapeHtml(campaign.name)}</strong>
                <span class="mono">${escapeHtml(campaign.id)}</span>
              </div>
              <span class="badge" style="${isLive ? "background:var(--ok-soft);color:var(--ok)" : "background:var(--warn-soft);color:var(--warn)"}">${escapeHtml(campaign.status)}</span>
              <div>
                <input class="limit-input" data-limit-input="${escapeHtml(campaign.id)}" type="number" min="1" max="500" value="${campaign.dailyLimit ?? ""}" aria-label="Daily limit for ${escapeHtml(campaign.name)}" />
                <button class="btn btn-plain" data-campaign-action="daily_limit" data-campaign-id="${escapeHtml(campaign.id)}" data-campaign-name="${escapeHtml(campaign.name)}">Set limit</button>
              </div>
              <div class="control-meta">
                ${isLive
                  ? `<button class="btn btn-reject" data-campaign-action="pause" data-campaign-id="${escapeHtml(campaign.id)}" data-campaign-name="${escapeHtml(campaign.name)}">Pause</button>`
                  : `<button class="btn btn-approve" data-campaign-action="resume" data-campaign-id="${escapeHtml(campaign.id)}" data-campaign-name="${escapeHtml(campaign.name)}">Resume</button>`}
                <span class="mono muted">${escapeHtml(campaign.schedule ?? "schedule unavailable")}</span>
              </div>
            </div>`;
          })
          .join("\n")}</div>`;

  return `
  <main class="reveal">
    ${m.pulse ? renderPulseStrip(m.pulse) : ""}
    ${m.pulse ? renderLiveTiles(m.pulse) : fallbackTiles}
    ${renderPersonaPerformance(m)}
    ${m.pulse ? renderInboxHealthTable(m.pulse) : ""}
    <h2>Owner controls</h2>
    <section class="control-card">
      <p class="muted" style="margin-top:0">Every change requires confirmation and a reason. Bruno records the before/after state in the audit log.</p>
      ${controls}
    </section>
    <h2>Last 7 days</h2>
    ${table}
  </main>`;
}

// ————— System —————

export interface SystemModel {
  agentPaused: boolean;
  queued: number;
  running: number;
  failed: number;
  oldestQueuedMinutes?: number;
  lastPollAgo?: string;
  lastPollStale: boolean;
  groups: Array<{ name: string; count: number; last_failed_at: string; latest_error: string | null }>;
  instantlyOk: boolean;
  claudeOk: boolean;
  sync: Array<{
    stream: string;
    status: string;
    records: number;
    currentRecords?: number;
    lastSuccessAt?: string;
    error?: string;
  }>;
  reconciliation: Array<{
    scope: string;
    matches: boolean;
    providerLeads?: number;
    localLeads?: number;
    providerSent?: number;
    localSent?: number;
    at: string;
  }>;
  actions: Array<{
    action: string;
    targetType: string;
    targetId?: string;
    actor: string;
    reason?: string;
    status: string;
    at: string;
  }>;
}

/** Translate the most common raw errors into owner language. */
function plainError(error: string | null) {
  if (!error) return undefined;
  if (/INSTANTLY_API_KEY is not configured|401|Unauthorized|Invalid API key/i.test(error)) {
    return "the Instantly connection is being rejected — the API key is missing or wrong. Emails may still send, but Bruno can't see replies until it's fixed.";
  }
  if (/ANTHROPIC/i.test(error)) {
    return "the Claude AI key is missing or invalid — Bruno can't classify replies or draft responses until it's fixed.";
  }
  if (/ECONNREFUSED|ETIMEDOUT|fetch failed|ENOTFOUND/i.test(error)) {
    return "a network problem reaching an outside service — usually temporary.";
  }
  if (/relation "sync_checkpoints" does not exist/i.test(error)) {
    return "this happened before the visibility migration was applied. If Data visibility now says ok, this old failure is safe to clear and does not need a retry.";
  }
  return undefined;
}

export function renderSystemPage(s: SystemModel, now: Date) {
  const problems: string[] = [];
  if (s.agentPaused) problems.push("Bruno is <strong>paused</strong> — nothing is being processed until you resume him (sidebar button).");
  if (!s.instantlyOk) {
    problems.push("Bruno can't reach Instantly right now — live campaign numbers and engagement are unavailable.");
  }
  if (!s.claudeOk) {
    problems.push("The Claude AI key is missing — Bruno can't classify replies, draft responses, or chat until it's added.");
  }
  if (s.lastPollStale) {
    problems.push(`Bruno hasn't been able to check for replies recently${s.lastPollAgo ? ` (last success ${s.lastPollAgo})` : ""}.`);
  }
  if (s.failed > 0) {
    const latest = s.groups[0];
    const translated = latest ? plainError(latest.latest_error) : undefined;
    problems.push(
      `${s.failed} background task${s.failed === 1 ? "" : "s"} gave up after retrying.${translated ? ` In plain terms: ${translated}` : ""}`
    );
  }
  const badSync = s.sync.find((stream) => stream.status === "error");
  if (badSync) problems.push(`The ${escapeHtml(badSync.stream)} synchronization is failing. CRM visibility may be incomplete until it recovers.`);
  const mismatch = s.reconciliation.find((run) => !run.matches);
  if (mismatch) problems.push(`The latest ${escapeHtml(mismatch.scope)} reconciliation found a provider/local mismatch.`);

  const hero =
    problems.length === 0
      ? `<div class="status-hero status-ok">
           <div class="status-mark">✓</div>
           <div><strong>Everything is running normally.</strong><br/>
           <span class="muted">Bruno checks for replies every 5 minutes${s.lastPollAgo ? ` — last check ${s.lastPollAgo}` : ""}. Silence here means healthy.</span><br/>
           <span class="mono muted">connections: instantly ✓ · claude ✓</span></div>
         </div>`
      : `<div class="status-hero status-bad">
           <div class="status-mark">!</div>
           <div>${problems.map((p) => `<p style="margin:0 0 6px">${p}</p>`).join("")}</div>
         </div>`;

  const groups =
    s.groups.length === 0
      ? `<p class="muted">No failed tasks.</p>`
      : `
      <div class="table-scroll">
        <table>
          <thead><tr><th>Task</th><th class="num">Failures</th><th>Last failed</th><th>Most recent error</th><th></th></tr></thead>
          <tbody>
            ${s.groups
              .map(
                (group) => `
                <tr>
                  <td class="mono">${escapeHtml(group.name)}</td>
                  <td class="mono num">${group.count}</td>
                  <td class="mono">${relativeTime(group.last_failed_at, now)}</td>
                  <td>${group.latest_error ? `<div class="err-detail">${escapeHtml(group.latest_error.slice(0, 500))}</div>` : `<span class="muted">—</span>`}</td>
                  <td class="mono" style="white-space:nowrap">
                    <button class="btn btn-plain" data-ops="retry" data-job-name="${escapeHtml(group.name)}">Retry latest</button>
                    <button class="btn btn-reject" data-ops="clear" data-job-name="${escapeHtml(group.name)}">Clear</button>
                  </td>
                </tr>`
              )
              .join("\n")}
          </tbody>
        </table>
      </div>
      <div class="card-actions" style="margin-top:14px">
        <button class="btn btn-reject" data-ops="clear">Clear all failed jobs</button>
        <span class="send-note mono">clearing deletes the failure records only — the schedules keep running</span>
      </div>`;

  const syncCards =
    s.sync.length === 0
      ? `<p class="muted">Sync has not completed its first pass yet.</p>`
      : `<div class="sync-grid">${s.sync
          .map(
            (stream) => `<div class="sync-card">
              <strong>${escapeHtml(stream.stream)}</strong>
              <span class="mono ${stream.status === "error" ? "sync-error" : "muted"}">${escapeHtml(stream.status)} · ${
                stream.currentRecords !== undefined
                  ? `${stream.currentRecords.toLocaleString("en-US")} current · ${stream.records.toLocaleString("en-US")} rows processed`
                  : `${stream.records.toLocaleString("en-US")} rows processed`
              }${stream.lastSuccessAt ? ` · ${relativeTime(stream.lastSuccessAt, now)}` : ""}</span>
              ${stream.error ? `<div class="sync-error mono">${escapeHtml(stream.error.slice(0, 500))}</div>` : ""}
            </div>`
          )
          .join("\n")}</div>`;
  const reconciliationRows =
    s.reconciliation.length === 0
      ? `<p class="muted">No reconciliation pass has finished yet.</p>`
      : `<div class="table-scroll"><table>
          <thead><tr><th>Scope</th><th>Result</th><th class="num">Leads · provider/local</th><th class="num">Sent · provider/local</th><th>Checked</th></tr></thead>
          <tbody>${s.reconciliation
            .map(
              (run) => `<tr>
                <td>${escapeHtml(run.scope)}</td>
                <td>${run.matches ? `<span class="ok-text">matches</span>` : `<span class="warn-text">mismatch</span>`}</td>
                <td class="mono num">${run.providerLeads ?? "—"} / ${run.localLeads ?? "—"}</td>
                <td class="mono num">${run.providerSent ?? "—"} / ${run.localSent ?? "—"}</td>
                <td class="mono">${relativeTime(run.at, now)}</td>
              </tr>`
            )
            .join("\n")}</tbody>
        </table></div>`;
  const actionRows =
    s.actions.length === 0
      ? `<p class="muted">No owner or agent control changes recorded.</p>`
      : `<div class="table-scroll"><table>
          <thead><tr><th>Action</th><th>Target</th><th>Actor</th><th>Reason</th><th>When</th></tr></thead>
          <tbody>${s.actions
            .map(
              (action) => `<tr>
                <td><span class="mono">${escapeHtml(action.action)}</span> · ${escapeHtml(action.status)}</td>
                <td>${escapeHtml(action.targetType)}${action.targetId ? `<div class="mono muted">${escapeHtml(action.targetId)}</div>` : ""}</td>
                <td>${escapeHtml(action.actor)}</td>
                <td>${escapeHtml(action.reason ?? "—")}</td>
                <td class="mono">${relativeTime(action.at, now)}</td>
              </tr>`
            )
            .join("\n")}</tbody>
        </table></div>`;

  return `
  <main class="reveal">
    ${hero}
    <h2>Data visibility</h2>
    ${syncCards}
    <h2>Provider reconciliation</h2>
    ${reconciliationRows}
    <h2>Control audit</h2>
    ${actionRows}
    <details class="tech">
      <summary class="mono">Technical details</summary>
      <section class="kpis kpis-3" style="margin-top:16px">
        <div class="tile">
          <div class="tile-label">Queued</div>
          <div class="tile-value">${s.queued}</div>
          <div class="tile-sub">${s.oldestQueuedMinutes !== undefined ? `oldest waiting ${s.oldestQueuedMinutes}m` : "nothing overdue"}</div>
        </div>
        <div class="tile">
          <div class="tile-label">Running</div>
          <div class="tile-value">${s.running}</div>
          <div class="tile-sub">in flight right now</div>
        </div>
        <div class="tile${s.failed > 0 ? " tile-bad" : ""}">
          <div class="tile-label">Failed</div>
          <div class="tile-value">${s.failed}</div>
          <div class="tile-sub">${s.failed > 0 ? "gave up after 5 attempts each" : "all clear"}</div>
        </div>
      </section>
      <h2>Failed tasks by type <span class="count mono">${s.failed}</span></h2>
      ${groups}
    </details>
  </main>`;
}
