// Shared dashboard chrome: the shell (sidebar + topbar + agent dock), the
// design tokens, and the client-side JS. Page bodies come from pages.ts.
// Dark, app-like theme in Kinta's palette (blue accent, orange CTA, k. mark).
// Every dynamic string goes through escapeHtml — prospect-authored text is
// untrusted input (AUDIT-M5) and must never reach the page unescaped.

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface SessionView {
  chatId: string;
  title: string;
  lastAt: string;
}

export interface ShellContext {
  active: "bruno" | "inbox" | "leads" | "activity" | "campaign" | "learning" | "system";
  title: string;
  pendingCount: number;
  failedJobs: number;
  agentPaused: boolean;
  generatedAt: Date;
  /** Reload every 60s while idle. Off for the chat page. */
  autoRefresh: boolean;
  /** Recent agent conversation, rendered into the floating dock (non-chat pages). */
  dockTurns?: ChatTurn[];
  /** The owner's chat sessions with Bruno, newest first (sidebar list). */
  sessions: SessionView[];
  /** Session highlighted in the sidebar / used by the chat page. */
  activeChatId?: string;
  /** Session the floating dock posts into (latest one). */
  dockChatId?: string;
  /** Timestamp of the newest # updates post (unread dot compares to localStorage). */
  updatesLatestAt?: string;
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Tinted badge + light text per intent, tuned for the dark surface. The label
// text always spells the intent, so color never carries the meaning alone.
const INTENT_STYLES: Record<string, { bg: string; fg: string }> = {
  positive: { bg: "rgba(74,222,128,0.13)", fg: "#4ade80" },
  question: { bg: "rgba(139,143,232,0.16)", fg: "#a5a9ff" },
  objection: { bg: "rgba(251,146,60,0.14)", fg: "#fdba74" },
  not_now: { bg: "rgba(148,163,184,0.14)", fg: "#cbd5e1" },
  negative: { bg: "rgba(248,113,113,0.14)", fg: "#fca5a5" },
  unsubscribe: { bg: "rgba(248,113,113,0.2)", fg: "#f87171" },
  // Distinct from unclear: an autoresponder is a confident read, not a puzzle.
  out_of_office: { bg: "rgba(56,189,248,0.14)", fg: "#7dd3fc" },
  unclear: { bg: "rgba(251,191,36,0.14)", fg: "#fcd34d" }
};

export function intentBadge(intent: string) {
  const style = INTENT_STYLES[intent] ?? INTENT_STYLES.unclear;
  // replaceAll, not replace: a string pattern swaps only the first match, so
  // out_of_office rendered as "out of_office" once an intent had two underscores.
  const label = intent.replaceAll("_", " ");
  return `<span class="badge" style="background:${style.bg};color:${style.fg}">${escapeHtml(label)}</span>`;
}

export function relativeTime(iso: string, now: Date) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.max(0, Math.floor((now.getTime() - then) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function whoLabel(companyName?: string, email?: string) {
  return companyName?.trim() || email?.trim() || "Unknown lead";
}

export function renderChatTurns(turns: ChatTurn[], emptyHtml: string) {
  if (turns.length === 0) {
    return emptyHtml;
  }
  return turns
    .map((turn) =>
      turn.role === "user"
        ? `<div class="msg msg-user">${escapeHtml(turn.content)}</div>`
        : `<div class="msg msg-agent"><div class="msg-tag">bruno</div>${escapeHtml(turn.content)}</div>`
    )
    .join("\n");
}

// 16px stroke icons (lucide-style), inherit currentColor.
const ICONS: Record<ShellContext["active"], string> = {
  bruno:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
  inbox:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
  leads:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  activity:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M8 8h8M8 12h5"/></svg>',
  campaign:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
  learning:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 0-4 12.74V18h8v-3.26A7 7 0 0 0 12 2z"/><path d="M9 22h6M9 18h6"/></svg>',
  system:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>'
};

const NAV_ITEMS: Array<{ key: ShellContext["active"]; href: string; label: string }> = [
  { key: "inbox", href: "/dashboard/inbox", label: "Inbox" },
  { key: "leads", href: "/dashboard/leads", label: "Leads" },
  { key: "activity", href: "/dashboard/activity", label: "Activity" },
  { key: "campaign", href: "/dashboard/campaign", label: "Campaign" },
  { key: "learning", href: "/dashboard/learning", label: "Learning" },
  { key: "system", href: "/dashboard/system", label: "System" }
];

function renderChannels(ctx: ShellContext) {
  const active = ctx.active === "bruno" && ctx.activeChatId === "updates";
  return `
  <div class="sessions channels">
    <div class="sessions-head"><span>Channels</span></div>
    <a class="sess${active ? " sess-active" : ""}" href="/dashboard?chat=updates" id="channel-updates" data-latest="${escapeHtml(ctx.updatesLatestAt ?? "")}">
      <span class="sess-title"><span class="ch-hash">#</span> updates</span>
      <span class="unread-dot" hidden></span>
      ${ctx.updatesLatestAt ? `<span class="sess-time mono">${relativeTime(ctx.updatesLatestAt, ctx.generatedAt)}</span>` : ""}
    </a>
  </div>`;
}

function renderSessions(ctx: ShellContext) {
  const items =
    ctx.sessions.length === 0
      ? `<div class="sess-empty muted">No chats yet — start one.</div>`
      : ctx.sessions
          .map(
            (session) =>
              `<a class="sess${ctx.active === "bruno" && session.chatId === ctx.activeChatId ? " sess-active" : ""}" href="/dashboard?chat=${encodeURIComponent(session.chatId)}">
                <span class="sess-title">${escapeHtml(session.title)}</span>
                <span class="sess-time mono">${relativeTime(session.lastAt, ctx.generatedAt)}</span>
              </a>`
          )
          .join("\n");
  return `
  <div class="sessions">
    <div class="sessions-head">
      <span>Chats</span>
      <a class="new-chat" href="/dashboard/new" title="New chat">+</a>
    </div>
    ${items}
  </div>`;
}

function navCount(item: ShellContext["active"], ctx: ShellContext) {
  if (item === "inbox" && ctx.pendingCount > 0) return `<span class="nav-count">${ctx.pendingCount}</span>`;
  if (item === "system" && ctx.failedJobs > 0) return `<span class="nav-count nav-count-bad">${ctx.failedJobs}</span>`;
  return "";
}

function renderDock(ctx: ShellContext) {
  if (ctx.active === "bruno" || !ctx.dockTurns) return "";
  return `
  <button class="dock-toggle" id="dock-toggle" aria-label="Chat with Bruno">✳ <span>Bruno</span></button>
  <div class="dock" id="dock" hidden>
    <div class="dock-head">
      <span class="mono">BRUNO</span>
      <a class="dock-expand mono" href="/dashboard">full view ↗</a>
      <button class="dock-close" id="dock-close" aria-label="Close">×</button>
    </div>
    <div class="chat" data-chat data-chat-id="${escapeHtml(ctx.dockChatId ?? "console")}">
      <div class="chat-scroll" data-chat-scroll>
        ${renderChatTurns(ctx.dockTurns.slice(-8), `<div class="chat-empty muted">Ask Bruno anything — campaign numbers, inbox health, a draft…</div>`)}
      </div>
      <form class="composer" data-chat-form>
        <textarea name="message" rows="2" placeholder="Ask Bruno…" required></textarea>
        <button class="btn btn-send" type="submit" aria-label="Send">${SEND_ICON}</button>
      </form>
    </div>
  </div>`;
}

export const SEND_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';

export function renderShell(ctx: ShellContext, contentHtml: string) {
  const updatedLabel = ctx.generatedAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  const agentChip = ctx.agentPaused
    ? `<span class="chip chip-paused"><span class="dot"></span>paused</span>`
    : `<span class="chip chip-live"><span class="dot"></span>running</span>`;
  const failedChip =
    ctx.failedJobs > 0
      ? `<a class="chip chip-warn" href="/dashboard/system">${ctx.failedJobs} failed job${ctx.failedJobs === 1 ? "" : "s"}</a>`
      : "";
  const navHtml = NAV_ITEMS.map(
    (item) =>
      `<a class="nav-item${item.key === ctx.active ? " nav-active" : ""}" href="${item.href}"><span class="nav-ic">${ICONS[item.key]}</span><span class="nav-label">${item.label}</span>${navCount(item.key, ctx)}</a>`
  ).join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Kinta · ${escapeHtml(ctx.title)}</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%231B1FD1'/%3E%3Ctext x='8' y='24' font-family='Verdana,sans-serif' font-weight='800' font-size='20' fill='white'%3Ek%3C/text%3E%3Ctext x='20' y='24' font-family='Verdana,sans-serif' font-weight='800' font-size='20' fill='%23F04E23'%3E.%3C/text%3E%3C/svg%3E" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@600;700;800;900&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
<style>
  /* Kinta palette on a dark, app-like theme */
  :root {
    --page: #0b0c12;
    --side-bg: #08090e;
    --surface: #13141c;
    --surface-2: #1a1c26;
    --ink: #f0f1f5;
    --ink-2: #b8bac6;
    --muted: #7d7f8e;
    --hairline: #23242f;
    --hairline-2: #2d2f3d;
    --brand-blue: #1b1fd1;      /* fills (logo, user bubble) — white text on top */
    --accent: #6e73ff;          /* links, focus, active — legible on dark */
    --accent-soft: rgba(110,115,255,0.12);
    --accent-mid: #8b8fe8;
    --cta: #f04e23;
    --cta-hover: #ff5f33;
    --ok: #34d374;
    --ok-soft: rgba(52,211,116,0.12);
    --danger: #f87171;
    --danger-soft: rgba(248,113,113,0.12);
    --warn: #fbbf24;
    --warn-soft: rgba(251,191,36,0.12);
    --sans: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
    --display: "Outfit", var(--sans);
    --mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--page);
    background-image: radial-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px);
    background-size: 24px 24px;
    color: var(--ink);
    font-family: var(--sans);
    font-size: 14.5px;
    line-height: 1.55;
    display: flex;
    min-height: 100vh;
  }
  body.chat-page { height: 100vh; overflow: hidden; }
  body.chat-page .content { min-height: 0; }
  h1, h2, h3, .brand-name { font-family: var(--display); }
  .mono { font-family: var(--mono); font-size: 12px; }
  .muted { color: var(--muted); }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  a { color: var(--accent); }
  ::selection { background: rgba(110,115,255,0.35); }

  /* ——— Sidebar ——— */
  .side {
    width: 224px; flex: 0 0 224px;
    background: var(--side-bg); border-right: 1px solid var(--hairline);
    display: flex; flex-direction: column;
    position: sticky; top: 0; height: 100vh;
  }
  .brand { display: flex; align-items: center; gap: 11px; padding: 20px 18px 18px; }
  /* Kinta's "k." mark, exactly as on kintalatam.com */
  .klogo {
    width: 32px; height: 32px; flex: 0 0 auto;
    background: var(--brand-blue); border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-family: var(--display); font-weight: 800; font-size: 18px; line-height: 1;
    box-shadow: 0 2px 12px rgba(27,31,209,0.4);
  }
  .klogo .k { color: #fff; }
  .klogo .dot { color: var(--cta); }
  .brand-name { font-weight: 800; font-size: 18px; letter-spacing: -0.02em; line-height: 1.1; color: #fff; }
  .brand-name .dot { color: var(--cta); }
  .brand-name small { display: block; font-family: var(--mono); font-weight: 500; color: var(--muted); font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase; margin-top: 3px; }

  .nav { display: flex; flex-direction: column; padding: 4px 10px; gap: 1px; }
  .nav-item {
    display: flex; align-items: center; gap: 10px;
    color: var(--ink-2); text-decoration: none;
    font-size: 13.5px; font-weight: 500;
    padding: 8px 10px; border-radius: 8px;
  }
  .nav-ic { width: 16px; height: 16px; flex: 0 0 auto; display: inline-flex; color: var(--muted); }
  .nav-ic svg { width: 16px; height: 16px; }
  .nav-label { flex: 1; }
  .nav-item:hover { color: var(--ink); background: var(--surface); }
  .nav-item:hover .nav-ic { color: var(--ink-2); }
  .nav-active { color: #fff; background: var(--surface-2); }
  .nav-active .nav-ic { color: var(--accent); }
  .nav-count {
    font-family: var(--mono); font-size: 10px; color: var(--page);
    background: var(--accent-mid); border-radius: 999px; padding: 1px 7px; font-weight: 600;
  }
  .nav-count-bad { background: var(--cta); color: #fff; }

  /* ——— Sidebar search ——— */
  .side-search { padding: 0 14px 10px; }
  .side-search input {
    width: 100%; background: var(--surface); border: 1px solid var(--hairline-2); border-radius: 8px;
    color: var(--ink); font: inherit; font-size: 12.5px; padding: 7px 10px; outline: none;
  }
  .side-search input::placeholder { color: var(--muted); }
  .side-search input:focus { border-color: var(--accent); }

  /* ——— Chat sessions ——— */
  .sessions { display: flex; flex-direction: column; padding: 14px 10px 6px; gap: 1px; min-height: 0; overflow-y: auto; }
  .sessions-head {
    display: flex; align-items: center; justify-content: space-between;
    font-family: var(--mono); font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase;
    color: var(--muted); padding: 0 10px 8px;
  }
  .new-chat {
    text-decoration: none; color: var(--ink-2); font-size: 16px; line-height: 1;
    width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center;
    border-radius: 6px; border: 1px solid var(--hairline-2);
  }
  .new-chat:hover { color: #fff; border-color: var(--accent); background: var(--accent-soft); }
  .sess {
    display: flex; align-items: baseline; gap: 8px; text-decoration: none;
    padding: 7px 10px; border-radius: 8px; color: var(--ink-2); font-size: 13px;
  }
  .sess:hover { background: var(--surface); color: var(--ink); }
  .sess-active { background: var(--surface-2); color: #fff; }
  .sess-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sess-time { flex: 0 0 auto; font-size: 10px; color: var(--muted); }
  .sess-empty { font-size: 12px; padding: 4px 10px; }
  .channels { padding-bottom: 0; flex: 0 0 auto; overflow: visible; }
  .ch-hash { color: var(--accent); font-weight: 700; }
  .unread-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--cta); flex: 0 0 auto; align-self: center; }
  .unread-dot[hidden] { display: none; }

  /* ——— Lead dossier timeline ——— */
  .lead-link { color: inherit; text-decoration: none; }
  .lead-link:hover { color: var(--accent); text-decoration: underline; }
  .sla-over { color: var(--cta-hover); font-weight: 600; }
  .tl { display: flex; flex-direction: column; gap: 10px; }
  .tl-item {
    display: flex; gap: 14px; align-items: flex-start;
    background: var(--surface); border: 1px solid var(--hairline); border-radius: 10px; padding: 12px 14px;
    overflow-wrap: anywhere;
  }
  .tl-tag {
    flex: 0 0 92px; font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.08em; text-transform: uppercase;
    padding: 3px 0; text-align: center; border-radius: 999px; margin-top: 2px;
  }
  .tl-us { background: var(--accent-soft); color: var(--accent); }
  .tl-them { background: rgba(240,78,35,0.13); color: #ff8a65; }
  .tl-bruno { background: var(--surface-2); color: var(--ink-2); border: 1px solid var(--hairline-2); }
  .tl-human { background: var(--ok-soft); color: var(--ok); }
  .tl-warn { background: var(--danger-soft); color: var(--danger); }
  .tl-body { flex: 1; min-width: 0; }
  .tl-head { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; font-size: 13.5px; }
  .tl-note { font-size: 13px; color: var(--ink-2); margin-top: 3px; }
  .tl-body blockquote {
    margin: 8px 0 0; padding: 9px 12px; border-left: 3px solid var(--hairline-2);
    background: var(--surface-2); border-radius: 0 8px 8px 0; color: var(--ink);
    white-space: pre-wrap; font-size: 13px; overflow-wrap: anywhere; max-height: 220px; overflow-y: auto;
  }
  .tl-body details > summary { cursor: pointer; margin-top: 6px; }
  .dossier-head .interest-form { display: flex; gap: 8px; align-items: center; }
  .interest-select {
    background: var(--surface-2); border: 1px solid var(--hairline-2); border-radius: 8px;
    color: var(--ink); font: inherit; font-size: 12.5px; padding: 8px 10px;
  }

  /* ——— Leads (CRM) ——— */
  .crm-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
  .crm-tab {
    background: var(--surface); border: 1px solid var(--hairline-2); border-radius: 999px;
    color: var(--ink-2); font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em;
    padding: 6px 13px; cursor: pointer;
  }
  .crm-tab:hover { border-color: var(--accent); color: var(--ink); }
  .crm-tab.sel { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
  .crm-search {
    flex: 1; min-width: 180px; background: var(--surface); border: 1px solid var(--hairline-2); border-radius: 999px;
    color: var(--ink); font: inherit; font-size: 12.5px; padding: 7px 14px; outline: none;
  }
  .crm-search:focus { border-color: var(--accent); }
  .crm-select, .crm-date {
    background: var(--surface); border: 1px solid var(--hairline-2); border-radius: 999px;
    color: var(--ink-2); font: var(--mono); font-size: 11px; padding: 7px 12px; outline: none;
  }
  .crm-select:focus, .crm-date:focus { border-color: var(--accent); }
  .crm-summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px; }
  .crm-stat {
    background: var(--surface); border: 1px solid var(--hairline); border-radius: 10px;
    padding: 12px 14px;
  }
  .crm-stat strong { display: block; font-family: var(--display); font-size: 23px; color: #fff; line-height: 1.1; }
  .crm-stat span { color: var(--muted); font-family: var(--mono); font-size: 10px; text-transform: uppercase; letter-spacing: .08em; }
  .pager {
    display: flex; align-items: center; justify-content: flex-end; gap: 10px;
    padding: 12px 2px 0;
  }
  .pager a { text-decoration: none; }
  .ledger-row { cursor: pointer; }
  .ledger-row:hover td { background: rgba(110,115,255,0.055); }
  .direction {
    display: inline-flex; min-width: 68px; justify-content: center;
    border-radius: 999px; padding: 3px 8px; font-family: var(--mono);
    font-size: 9px; letter-spacing: .08em; text-transform: uppercase;
  }
  .direction-sent { color: var(--accent-mid); background: var(--accent-soft); }
  .direction-received { color: #ff956f; background: rgba(240,78,35,.14); }
  .direction-manual { color: var(--ok); background: var(--ok-soft); }
  .ledger-preview { max-width: 440px; color: var(--ink-2); }
  .ledger-detail td { padding: 0; }
  .ledger-detail[hidden] { display: none; }
  .ledger-message {
    margin: 2px 8px 12px; padding: 14px 16px; white-space: pre-wrap;
    border-left: 3px solid var(--accent); border-radius: 0 8px 8px 0;
    background: var(--surface-2); color: var(--ink); font-size: 13px;
    max-height: 360px; overflow: auto;
  }
  .lesson-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 12px; }
  .lesson {
    background: var(--surface); border: 1px solid var(--hairline); border-radius: 12px;
    padding: 16px; display: flex; flex-direction: column; gap: 10px;
  }
  .lesson.lesson-proposed { border-color: rgba(251,191,36,.4); }
  .lesson.lesson-active { border-color: rgba(52,211,116,.35); }
  .lesson-head { display: flex; align-items: center; gap: 8px; }
  .lesson-head .confidence { margin-left: auto; color: var(--muted); }
  .lesson-text { font-size: 14px; color: var(--ink); line-height: 1.6; }
  .lesson-evidence {
    color: var(--muted); font-family: var(--mono); font-size: 10.5px;
    white-space: pre-wrap; overflow-wrap: anywhere; max-height: 130px; overflow-y: auto;
  }
  .lesson-actions { display: flex; gap: 8px; align-items: center; margin-top: auto; }
  .control-card {
    background: linear-gradient(135deg, rgba(110,115,255,.08), rgba(240,78,35,.035));
    border: 1px solid var(--hairline-2); border-radius: 12px; padding: 16px;
  }
  .control-list { display: flex; flex-direction: column; gap: 8px; }
  .control-row {
    display: grid; grid-template-columns: minmax(220px, 1fr) 110px 110px 1fr;
    align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--hairline);
  }
  .control-row:last-child { border-bottom: none; }
  .control-name strong { display: block; color: var(--ink); }
  .control-name span { color: var(--muted); }
  .limit-input {
    width: 90px; background: var(--page); border: 1px solid var(--hairline-2);
    border-radius: 7px; color: var(--ink); font: var(--mono); padding: 7px 8px;
  }
  .sync-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; margin-top: 16px; }
  .sync-card {
    background: var(--surface); border: 1px solid var(--hairline); border-radius: 10px; padding: 13px 14px;
  }
  .sync-card strong { display: block; color: var(--ink); }
  .sync-error { color: var(--danger); overflow-wrap: anywhere; }

  .side-foot { margin-top: auto; padding: 14px; border-top: 1px solid var(--hairline); display: flex; flex-direction: column; gap: 8px; }
  .chip {
    font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase;
    display: inline-flex; align-items: center; gap: 7px; width: fit-content;
    padding: 4px 10px; border-radius: 999px; border: 1px solid var(--hairline-2);
    color: var(--ink-2); text-decoration: none; background: var(--surface);
  }
  .chip .dot { width: 7px; height: 7px; border-radius: 50%; }
  .chip-live .dot { background: var(--ok); animation: pulse 2.4s ease-in-out infinite; }
  .chip-paused { border-color: var(--warn); color: var(--warn); }
  .chip-paused .dot { background: var(--warn); }
  .chip-warn { border-color: var(--cta); color: var(--cta-hover); }
  @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }
  .btn-ghost-light {
    background: transparent; color: var(--ink-2); border: 1px solid var(--hairline-2);
    font-family: var(--mono); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em;
    padding: 6px 12px; border-radius: 999px; cursor: pointer; width: fit-content;
  }
  .btn-ghost-light:hover { border-color: var(--muted); color: var(--ink); }
  .side-updated { color: var(--muted); font-size: 10px; }

  /* ——— Content column ——— */
  .content { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .topbar {
    display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
    padding: 16px 26px 0; max-width: 1012px; width: 100%; margin: 0 auto;
  }
  .topbar h1 { font-size: 19px; font-weight: 700; letter-spacing: -0.01em; margin: 0; margin-right: auto; color: #fff; }
  main { padding: 18px 26px 60px; max-width: 1012px; width: 100%; margin: 0 auto; }
  main.main-chat { flex: 1; min-height: 0; display: flex; flex-direction: column; padding-bottom: 24px; max-width: none; }
  body.chat-page .topbar { max-width: none; }

  .reveal { animation: rise 0.45s cubic-bezier(0.2, 0.7, 0.3, 1) both; animation-delay: calc(var(--d, 0) * 90ms); }
  @keyframes rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }

  h2 {
    font-size: 15px; font-weight: 700; letter-spacing: 0.01em; color: var(--ink);
    margin: 26px 0 12px; display: flex; align-items: baseline; gap: 10px;
    border-bottom: 1px solid var(--hairline-2); padding-bottom: 9px;
  }
  h2:first-child { margin-top: 0; }
  h2 .count { color: var(--muted); font-weight: 500; }

  /* ——— Tiles ——— */
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 10px; }
  .kpis-3 { grid-template-columns: repeat(3, 1fr); }
  .tile {
    background: var(--surface); border: 1px solid var(--hairline); border-radius: 12px;
    padding: 15px 17px 13px; min-width: 0;
  }
  .tile-label { font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
  .tile-value { font-family: var(--display); font-weight: 800; font-size: 32px; line-height: 1.15; margin-top: 6px; color: #fff; font-variant-numeric: tabular-nums; }
  .tile-sub { font-size: 12px; color: var(--ink-2); margin-top: 2px; }
  .tile-attention { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .tile-attention .tile-value { color: var(--accent); }
  .tile-bad { border-color: var(--cta); box-shadow: 0 0 0 3px rgba(240,78,35,0.12); }
  .tile-bad .tile-value { color: var(--cta-hover); }

  /* ——— Cards ——— */
  .card {
    background: var(--surface); border: 1px solid var(--hairline); border-radius: 12px;
    padding: 18px; margin-bottom: 14px;
    transition: opacity 0.35s ease, transform 0.35s ease; overflow-wrap: anywhere;
  }
  .card.card-done { opacity: 0; transform: translateX(14px); }
  .card-head { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .card-head h3 { margin: 0; font-size: 15.5px; font-weight: 700; color: #fff; }
  .card-meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .badge {
    font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase;
    padding: 3px 9px; border-radius: 999px; white-space: nowrap;
  }
  .section-label {
    display: block; font-family: var(--mono); font-size: 10px; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--muted); margin-bottom: 4px;
  }
  .prospect { margin-top: 14px; }
  .prospect blockquote {
    margin: 0; padding: 10px 14px; border-left: 3px solid var(--accent);
    background: var(--accent-soft); border-radius: 0 8px 8px 0; color: var(--ink);
    max-height: 180px; overflow-y: auto; white-space: pre-wrap; font-size: 13.5px;
    overflow-wrap: anywhere;
  }
  .agent-note { margin-top: 12px; font-size: 13px; color: var(--ink-2); }
  .agent-note .section-label { display: inline; margin-right: 6px; }
  .field { display: block; margin-top: 12px; }
  .field input, .field textarea {
    width: 100%; border: 1px solid var(--hairline-2); border-radius: 8px;
    background: var(--surface-2); padding: 9px 12px; font: inherit; font-size: 13.5px; color: var(--ink);
  }
  .field textarea { resize: vertical; line-height: 1.55; }
  .field input:focus, .field textarea:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: var(--accent); }
  .card-actions { display: flex; align-items: center; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
  .btn {
    font-family: var(--mono); font-size: 11.5px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;
    border-radius: 8px; padding: 9px 16px; cursor: pointer; border: 1px solid transparent;
  }
  .btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .btn-approve { background: var(--cta); color: #fff; }
  .btn-approve:hover:not(:disabled) { background: var(--cta-hover); }
  .btn-reject { background: transparent; color: var(--danger); border-color: rgba(248,113,113,0.4); }
  .btn-reject:hover:not(:disabled) { background: var(--danger-soft); }
  .btn-plain { background: var(--surface-2); color: var(--ink-2); border-color: var(--hairline-2); }
  .btn-plain:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .send-note { color: var(--muted); font-size: 11px; }
  .warn-text { color: var(--warn); background: var(--warn-soft); padding: 2px 6px; border-radius: 4px; }
  .action-status { font-size: 11px; }
  .action-status.err { color: var(--danger); }
  .action-status.ok { color: var(--ok); }
  .ok-text { color: var(--ok); font-family: var(--mono); font-size: 11px; }

  .empty {
    background: var(--surface); border: 1px dashed var(--hairline-2); border-radius: 12px;
    padding: 36px 20px; text-align: center; color: var(--muted);
  }
  .empty-mark {
    font-family: var(--mono); font-size: 26px; color: var(--ok);
    width: 52px; height: 52px; line-height: 52px; margin: 0 auto 10px;
    border: 1px solid var(--hairline-2); border-radius: 50%; background: var(--ok-soft);
  }

  /* ——— Live Instantly pulse ——— */
  .pulse {
    display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 20px;
    background: var(--surface); border: 1px solid var(--hairline-2); border-radius: 12px;
    padding: 13px 18px; margin-bottom: 20px;
  }
  .pulse-label {
    font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.16em; text-transform: uppercase;
    color: var(--accent); margin-right: 4px;
  }
  .pulse-item { font-family: var(--mono); font-size: 11.5px; color: var(--muted); white-space: nowrap; }
  .pulse-item strong { color: #fff; font-size: 14.5px; font-weight: 600; }
  .pulse-dim { color: var(--muted); opacity: 0.7; }

  .eng { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
  .eng span {
    font-family: var(--mono); font-size: 10.5px; color: var(--ink-2);
    background: var(--surface-2); border: 1px solid var(--hairline-2); border-radius: 999px; padding: 3px 9px;
  }

  /* ——— Today (briefing dropdown on the chat page) ——— */
  .today-row { display: flex; justify-content: flex-end; margin-bottom: 8px; position: relative; }
  .today-btn {
    display: inline-flex; align-items: center; gap: 8px; cursor: pointer;
    background: var(--surface); border: 1px solid var(--hairline-2); border-radius: 999px;
    color: var(--ink-2); font-family: var(--mono); font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase;
    padding: 6px 14px;
  }
  .today-btn:hover { border-color: var(--accent); color: var(--ink); }
  .today-btn .t-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); }
  .today-btn .t-dot.hot { background: var(--cta); animation: pulse 2.4s ease-in-out infinite; }
  .today-panel {
    position: absolute; top: calc(100% + 8px); right: 0; z-index: 35;
    width: min(600px, 92vw);
    background: var(--surface); border: 1px solid var(--hairline-2); border-radius: 12px;
    padding: 14px 18px 12px; box-shadow: 0 16px 50px rgba(0,0,0,0.55);
  }
  .today-panel[hidden] { display: none; }

  /* ——— Briefing rows ——— */
  .briefing-title { font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; }
  .briefing-row { display: flex; gap: 10px; align-items: baseline; font-size: 13px; padding: 4px 0; overflow-wrap: anywhere; }
  .briefing-row a { color: var(--accent); text-decoration: none; font-weight: 600; white-space: nowrap; }
  .briefing-row a:hover { text-decoration: underline; }
  .b-flag {
    flex: 0 0 auto; font-family: var(--mono); font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase;
    padding: 2px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent);
  }
  .b-flag.b-hot { background: rgba(240,78,35,0.14); color: var(--cta-hover); }
  .b-flag.b-warn { background: var(--danger-soft); color: var(--danger); }
  .b-flag.b-ok { background: var(--ok-soft); color: var(--ok); }

  /* ——— System status hero ——— */
  .status-hero {
    display: flex; gap: 16px; align-items: flex-start;
    background: var(--surface); border: 1px solid var(--hairline); border-radius: 12px;
    padding: 20px; font-size: 14.5px;
  }
  .status-mark {
    flex: 0 0 auto; width: 44px; height: 44px; line-height: 44px; text-align: center;
    border-radius: 50%; font-family: var(--mono); font-size: 22px; font-weight: 600;
  }
  .status-ok { border-color: rgba(52,211,116,0.4); }
  .status-ok .status-mark { background: var(--ok-soft); color: var(--ok); }
  .status-bad { border-color: rgba(240,78,35,0.5); }
  .status-bad .status-mark { background: rgba(240,78,35,0.14); color: var(--cta-hover); }
  details.tech { margin-top: 22px; }
  details.tech > summary {
    cursor: pointer; color: var(--muted); letter-spacing: 0.1em; text-transform: uppercase;
    padding: 6px 0; user-select: none;
  }
  details.tech > summary:hover { color: var(--accent); }

  /* ——— Lists & tables ——— */
  .mix-row { display: grid; grid-template-columns: 118px 1fr 34px; align-items: center; gap: 10px; margin-bottom: 9px; }
  .mix-track { display: block; height: 8px; border-radius: 4px; }
  .mix-bar { display: block; height: 8px; border-radius: 4px; background: var(--accent); }
  .mix-count { text-align: right; }
  .table-scroll { overflow-x: auto; background: var(--surface); border: 1px solid var(--hairline); border-radius: 12px; padding: 6px 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th {
    text-align: left; font-family: var(--mono); font-size: 10px; letter-spacing: 0.1em;
    text-transform: uppercase; color: var(--muted); font-weight: 500;
    padding: 8px 8px 6px; border-bottom: 1px solid var(--hairline-2);
  }
  td { padding: 8px; border-bottom: 1px solid var(--hairline); vertical-align: top; color: var(--ink-2); }
  td strong, td .mono { color: var(--ink); }
  tr:last-child td { border-bottom: none; }
  .feed-row { padding: 10px 0; border-bottom: 1px solid var(--hairline); overflow-wrap: anywhere; }
  .feed-row:last-child { border-bottom: none; }
  .feed-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13px; }
  .feed-top strong { color: var(--ink); }
  .feed-reason { font-size: 12.5px; margin-top: 3px; }
  .log-row { display: flex; gap: 10px; align-items: baseline; padding: 6px 0; font-size: 12px; color: var(--ink-2); }
  .log-action { text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
  .log-approved, .log-edited { color: var(--ok); }
  .log-rejected { color: var(--danger); }
  .err-detail {
    font-family: var(--mono); font-size: 11px; color: var(--danger);
    background: var(--danger-soft); border-radius: 6px; padding: 6px 9px; margin-top: 6px;
    overflow-wrap: anywhere; max-width: 640px;
  }

  /* ——— Chat ——— */
  .chat { display: flex; flex-direction: column; min-height: 0; flex: 1; }
  .chat-scroll { flex: 1; overflow-y: auto; padding: 4px 2px; display: flex; flex-direction: column; gap: 12px; }
  .chat-empty { text-align: center; padding: 26px 12px; font-size: 13px; }
  .chat-welcome { margin: auto; text-align: center; padding: 20px 20px 8vh; max-width: 560px; }
  .bruno-mark {
    width: 76px; height: 76px; line-height: 76px; margin: 0 auto 18px;
    border-radius: 22px; background: var(--brand-blue); color: #fff;
    font-size: 32px; box-shadow: 0 12px 40px rgba(27,31,209,0.45);
  }
  .chat-welcome h2 { border: none; margin: 0 0 8px; padding: 0; font-size: 26px; font-weight: 800; display: block; color: #fff; }
  .chat-welcome p { color: var(--muted); font-size: 13.5px; margin: 0; }
  .chat-welcome .hint { margin-top: 6px; font-size: 12.5px; }
  .suggestions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 26px; }
  .suggestion {
    font-family: var(--sans); font-size: 13px; color: var(--ink-2); text-align: center;
    background: var(--surface); border: 1px solid var(--hairline-2); border-radius: 10px;
    padding: 12px 14px; cursor: pointer;
  }
  .suggestion:hover { border-color: var(--accent); color: var(--ink); background: var(--surface-2); }

  .chat-scroll { overscroll-behavior: contain; }
  .msg { max-width: min(72%, 720px); padding: 11px 15px; border-radius: 14px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; animation: msgIn 0.3s cubic-bezier(0.2, 0.7, 0.3, 1) both; }
  @keyframes msgIn { from { opacity: 0; transform: translateY(10px) scale(0.985); } to { opacity: 1; transform: none; } }
  .msg-status { font-size: 12px; color: var(--muted); margin-left: 8px; }
  .type-caret { display: inline-block; width: 7px; height: 14px; background: var(--accent); margin-left: 2px; vertical-align: -2px; border-radius: 1px; animation: blink 1s infinite; }
  .msg-user { align-self: flex-end; background: var(--brand-blue); color: #fff; border-bottom-right-radius: 4px; }
  .msg-agent {
    align-self: flex-start; background: var(--surface); border: 1px solid var(--hairline);
    border-bottom-left-radius: 4px; color: var(--ink);
  }
  .msg-tag { font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); margin-bottom: 4px; }
  .msg-tag::before { content: "✳ "; color: var(--accent); }
  .msg-tools { font-family: var(--mono); font-size: 10.5px; color: var(--muted); margin-top: 8px; }
  .msg-pending .dots span { animation: blink 1.2s infinite; }
  .msg-pending .dots span:nth-child(2) { animation-delay: 0.2s; }
  .msg-pending .dots span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes blink { 0%,100% { opacity: 0.2 } 50% { opacity: 1 } }

  .composer {
    display: flex; gap: 10px; align-items: flex-end; margin-top: 14px;
    background: var(--surface); border: 1px solid var(--hairline-2); border-radius: 16px;
    padding: 8px 8px 8px 16px;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }
  .composer:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .composer textarea {
    flex: 1; border: none; background: transparent; outline: none;
    padding: 8px 0; font: inherit; font-size: 14px; color: var(--ink); resize: none; max-height: 140px;
  }
  .composer textarea::placeholder { color: var(--muted); }
  .btn-send {
    background: var(--brand-blue); color: #fff; border-radius: 11px;
    width: 40px; height: 40px; display: inline-flex; align-items: center; justify-content: center;
    padding: 0; flex: 0 0 auto;
  }
  .btn-send:hover:not(:disabled) { background: #2c31e8; }
  .composer-wrap { margin-top: 14px; position: relative; }
  .composer-wrap .composer { margin-top: 0; }
  .palette {
    position: absolute; left: 0; right: 0; bottom: calc(100% + 8px); z-index: 30;
    background: var(--surface); border: 1px solid var(--hairline-2); border-radius: 12px;
    box-shadow: 0 12px 40px rgba(0,0,0,0.5); overflow: hidden;
  }
  .palette[hidden] { display: none; }
  .palette-item {
    display: flex; align-items: baseline; gap: 12px; width: 100%; text-align: left;
    background: none; border: none; cursor: pointer; padding: 10px 14px;
    color: var(--ink-2); font-family: var(--sans); font-size: 13px;
    border-bottom: 1px solid var(--hairline);
  }
  .palette-item:last-child { border-bottom: none; }
  .palette-item .cmd { font-family: var(--mono); font-size: 12px; color: var(--accent); min-width: 90px; }
  .palette-item:hover, .palette-item.sel { background: var(--surface-2); color: var(--ink); }
  .composer-foot {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 8px 6px 0; font-family: var(--mono); font-size: 10.5px; color: var(--muted);
  }
  .composer-foot .live-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--ok); margin-right: 6px; vertical-align: 1px; }
  .composer-foot .live-dot.paused { background: var(--warn); }

  /* ——— Dock ——— */
  .dock-toggle {
    position: fixed; right: 20px; bottom: 20px; z-index: 40;
    background: var(--brand-blue); color: #fff; border: none; cursor: pointer;
    font-family: var(--mono); font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase;
    padding: 12px 18px; border-radius: 999px; box-shadow: 0 8px 28px rgba(27,31,209,0.5);
  }
  .dock-toggle:hover { background: #2c31e8; }
  .dock {
    position: fixed; right: 20px; bottom: 20px; z-index: 41;
    width: 360px; max-width: calc(100vw - 24px); height: 500px; max-height: calc(100vh - 40px);
    background: var(--page); border: 1px solid var(--hairline-2); border-radius: 14px;
    box-shadow: 0 16px 50px rgba(0,0,0,0.6);
    display: flex; flex-direction: column; overflow: hidden;
  }
  .dock[hidden] { display: none; }
  .dock-head {
    background: var(--side-bg); color: #fff; border-bottom: 1px solid var(--hairline);
    display: flex; align-items: center; gap: 12px; padding: 10px 14px;
  }
  .dock-head .mono { letter-spacing: 0.16em; }
  .dock-expand { color: var(--accent); text-decoration: none; margin-left: auto; }
  .dock-close { background: none; border: none; color: var(--ink-2); font-size: 18px; cursor: pointer; line-height: 1; }
  .dock .chat { padding: 12px; }
  .dock .msg { max-width: 88%; font-size: 13px; }
  .dock .composer { margin-top: 10px; padding: 6px 6px 6px 12px; }
  .dock .composer textarea { padding: 6px 0; font-size: 13px; }
  .dock .btn-send { width: 36px; height: 36px; }

  footer.page-foot { text-align: center; color: var(--muted); font-family: var(--mono); font-size: 11px; padding: 14px; }

  @media (max-width: 880px) {
    body { flex-direction: column; }
    .side { width: 100%; flex: none; height: auto; position: static; border-right: none; border-bottom: 1px solid var(--hairline); }
    .nav { flex-direction: row; overflow-x: auto; padding: 0 10px 10px; }
    .nav-item { white-space: nowrap; }
    .side-foot { display: none; }
    .kpis, .kpis-3 { grid-template-columns: repeat(2, 1fr); }
    .tile-value { font-size: 26px; }
    .msg { max-width: 88%; }
    main { padding: 14px 16px 60px; }
    .topbar { padding: 14px 16px 0; }
    .suggestions { grid-template-columns: 1fr; }
    .crm-summary, .lesson-grid, .sync-grid { grid-template-columns: 1fr 1fr; }
    .control-row { grid-template-columns: 1fr auto; }
    .control-row .control-meta { grid-column: 1 / -1; }
  }
  @media (max-width: 560px) {
    .crm-summary, .lesson-grid, .sync-grid { grid-template-columns: 1fr; }
  }
</style>
</head>
<body data-autorefresh="${ctx.autoRefresh ? "1" : "0"}"${ctx.active === "bruno" ? ' class="chat-page"' : ""}>
<aside class="side">
  <a class="brand" href="/dashboard" style="text-decoration:none">
    <div class="klogo"><span class="k">k</span><span class="dot">.</span></div>
    <div class="brand-name">kinta<span class="dot">.</span><small>outbound console</small></div>
  </a>
  <form class="side-search" action="/dashboard/search" method="get">
    <input type="search" name="q" placeholder="Search leads…" required minlength="2" />
  </form>
  <nav class="nav">
    ${navHtml}
  </nav>
  ${renderChannels(ctx)}
  ${renderSessions(ctx)}
  <div class="side-foot">
    ${agentChip}
    ${failedChip}
    <button class="btn-ghost-light" id="pause-btn" data-paused="${ctx.agentPaused}">${ctx.agentPaused ? "Resume Bruno" : "Pause Bruno"}</button>
    <span class="mono side-updated">updated ${updatedLabel}</span>
  </div>
</aside>
<div class="content">
  <div class="topbar">
    <h1>${escapeHtml(ctx.title)}</h1>
    ${failedChip}
  </div>
  ${contentHtml}
</div>
${renderDock(ctx)}
<script>
(function () {
  var dirty = false;
  var chatBusy = false;
  document.addEventListener("input", function () { dirty = true; });
  if (document.body.getAttribute("data-autorefresh") === "1") {
    setInterval(function () {
      var dockOpen = document.getElementById("dock") && !document.getElementById("dock").hidden;
      if (!dirty && !chatBusy && !dockOpen && document.visibilityState === "visible") location.reload();
    }, 60000);
  }

  /* ——— Agent chat (full page and dock share this) ——— */
  function nearBottom(scroll) {
    return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 140;
  }
  function scrollBottom(scroll, smooth) {
    scroll.scrollTo({ top: scroll.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }
  function appendMsg(scroll, cls, text, tag, tools) {
    var el = document.createElement("div");
    el.className = "msg " + cls;
    if (tag) {
      var t = document.createElement("div");
      t.className = "msg-tag";
      t.textContent = tag;
      el.appendChild(t);
    }
    var body = document.createElement("span");
    body.className = "msg-body";
    body.textContent = text;
    el.appendChild(body);
    if (tools && tools.length) {
      var tl = document.createElement("div");
      tl.className = "msg-tools";
      tl.textContent = "↳ checked: " + tools.join(", ");
      el.appendChild(tl);
    }
    var empty = scroll.querySelector(".chat-empty, .chat-welcome");
    if (empty) empty.remove();
    scroll.appendChild(el);
    return el;
  }
  /* Typewriter reveal: paces the whole answer to ~2s, follows with the scroll
     only while the reader is already at the bottom. */
  function typeInto(el, scroll, text, tools) {
    var body = el.querySelector(".msg-body");
    var caret = document.createElement("span");
    caret.className = "type-caret";
    el.appendChild(caret);
    var i = 0;
    var step = Math.max(2, Math.ceil(text.length / 110));
    (function tick() {
      i = Math.min(text.length, i + step);
      body.textContent = text.slice(0, i);
      if (nearBottom(scroll)) scrollBottom(scroll, false);
      if (i < text.length) { setTimeout(tick, 16); return; }
      caret.remove();
      if (tools && tools.length) {
        var tl = document.createElement("div");
        tl.className = "msg-tools";
        tl.textContent = "↳ checked: " + tools.join(", ");
        el.appendChild(tl);
        if (nearBottom(scroll)) scrollBottom(scroll, true);
      }
    })();
  }
  var THINKING = ["thinking…", "checking live data…", "pulling the numbers…", "writing it up…"];

  /* ——— Slash commands ——— */
  var COMMANDS = [
    { cmd: "/new", desc: "Start a new chat", run: function () { location.href = "/dashboard/new"; } },
    { cmd: "/status", desc: "Full status update from Bruno", run: function (form, textarea) {
        textarea.value = "Give me a full status update: campaign, inboxes, replies, and anything that needs my attention.";
        form.requestSubmit();
      } },
    { cmd: "/pause", desc: "Pause Bruno (stops classifying and drafting)", run: function () { setPaused(true); } },
    { cmd: "/resume", desc: "Resume Bruno", run: function () { setPaused(false); } },
    { cmd: "/inbox", desc: "Open the Inbox", run: function () { location.href = "/dashboard/inbox"; } },
    { cmd: "/campaign", desc: "Open Campaign", run: function () { location.href = "/dashboard/campaign"; } },
    { cmd: "/system", desc: "Open System health", run: function () { location.href = "/dashboard/system"; } }
  ];
  function setPaused(paused) {
    fetch("/dashboard/api/agent/pause", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paused: paused })
    }).then(function (r) { if (r.ok) location.reload(); });
  }

  document.querySelectorAll("[data-chat-form]").forEach(function (form) {
    var chat = form.closest("[data-chat]");
    var scroll = chat.querySelector("[data-chat-scroll]");
    var textarea = form.querySelector("textarea");
    var chatId = chat.getAttribute("data-chat-id") || "console";
    var palette = form.parentElement ? form.parentElement.querySelector(".palette") : null;
    scrollBottom(scroll, false);

    function autogrow() {
      textarea.style.height = "auto";
      textarea.style.height = Math.min(textarea.scrollHeight, 140) + "px";
    }
    textarea.addEventListener("input", autogrow);

    function matchedCommands() {
      var value = textarea.value.trim().toLowerCase();
      if (!value.startsWith("/")) return [];
      return COMMANDS.filter(function (c) { return c.cmd.indexOf(value) === 0; });
    }
    function renderPalette() {
      if (!palette) return;
      var matches = matchedCommands();
      if (matches.length === 0) { palette.hidden = true; return; }
      palette.innerHTML = matches.map(function (c, i) {
        return '<button type="button" class="palette-item' + (i === 0 ? " sel" : "") + '" data-cmd="' + c.cmd + '"><span class="cmd">' + c.cmd + '</span><span>' + c.desc + "</span></button>";
      }).join("");
      palette.hidden = false;
      palette.querySelectorAll(".palette-item").forEach(function (item) {
        item.addEventListener("click", function () {
          palette.hidden = true;
          var command = COMMANDS.find(function (c) { return c.cmd === item.getAttribute("data-cmd"); });
          textarea.value = "";
          if (command) command.run(form, textarea);
        });
      });
    }
    textarea.addEventListener("input", renderPalette);

    textarea.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && palette && !palette.hidden) { palette.hidden = true; return; }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        var matches = matchedCommands();
        if (palette && matches.length > 0) {
          palette.hidden = true;
          textarea.value = "";
          matches[0].run(form, textarea);
          return;
        }
        form.requestSubmit();
      }
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (palette) palette.hidden = true;
      var message = textarea.value.trim();
      if (!message || chatBusy) return;
      chatBusy = true;
      textarea.value = "";
      autogrow();
      form.querySelector("button").disabled = true;
      appendMsg(scroll, "msg-user", message);
      scrollBottom(scroll, true);

      var pending = appendMsg(scroll, "msg-agent msg-pending", "", "bruno");
      pending.insertAdjacentHTML(
        "beforeend",
        '<span class="dots"><span>●</span> <span>●</span> <span>●</span></span><span class="msg-status">' + THINKING[0] + "</span>"
      );
      scrollBottom(scroll, true);
      var thinkStep = 0;
      var thinkTimer = setInterval(function () {
        thinkStep = Math.min(THINKING.length - 1, thinkStep + 1);
        var status = pending.querySelector(".msg-status");
        if (status) status.textContent = THINKING[thinkStep];
      }, 2200);

      fetch("/dashboard/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: message, chatId: chatId })
      })
        .then(function (response) { return response.json().then(function (body) { return { ok: response.ok, body: body }; }); })
        .then(function (result) {
          clearInterval(thinkTimer);
          pending.remove();
          if (result.ok) {
            var el = appendMsg(scroll, "msg-agent", "", "bruno");
            if (nearBottom(scroll)) scrollBottom(scroll, false);
            typeInto(el, scroll, result.body.text, result.body.toolCalls);
          } else {
            appendMsg(scroll, "msg-agent", (result.body && result.body.error) || "Something went wrong — try again.", "bruno");
            scrollBottom(scroll, true);
          }
        })
        .catch(function () {
          clearInterval(thinkTimer);
          pending.remove();
          appendMsg(scroll, "msg-agent", "Network error — try again.", "bruno");
          scrollBottom(scroll, true);
        })
        .finally(function () {
          chatBusy = false;
          form.querySelector("button").disabled = false;
          textarea.focus();
        });
    });
  });

  document.querySelectorAll(".suggestion").forEach(function (button) {
    button.addEventListener("click", function () {
      var form = document.querySelector("[data-chat-form]");
      form.querySelector("textarea").value = button.textContent;
      form.requestSubmit();
    });
  });

  /* ——— Today dropdown ——— */
  var todayBtn = document.getElementById("today-btn");
  var todayPanel = document.getElementById("today-panel");
  if (todayBtn && todayPanel) {
    todayBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      todayPanel.hidden = !todayPanel.hidden;
    });
    document.addEventListener("click", function (event) {
      if (!todayPanel.hidden && !todayPanel.contains(event.target)) todayPanel.hidden = true;
    });
  }

  var toggle = document.getElementById("dock-toggle");
  var dock = document.getElementById("dock");
  if (toggle && dock) {
    toggle.addEventListener("click", function () {
      dock.hidden = false;
      toggle.hidden = true;
      var scroll = dock.querySelector("[data-chat-scroll]");
      scroll.scrollTop = scroll.scrollHeight;
      dock.querySelector("textarea").focus();
    });
    document.getElementById("dock-close").addEventListener("click", function () {
      dock.hidden = true;
      toggle.hidden = false;
    });
  }

  /* ——— Approvals ——— */
  function setStatus(card, message, kind) {
    var el = card.querySelector(".action-status");
    el.textContent = message;
    el.className = "action-status mono" + (kind ? " " + kind : "");
  }
  function enableButtons(card) {
    card.querySelectorAll("button[data-action]").forEach(function (b) {
      if (!b.hasAttribute("data-locked")) b.disabled = false;
    });
  }
  function finishCard(card) {
    card.classList.add("card-done");
    setTimeout(function () {
      card.remove();
      var remaining = document.querySelectorAll(".card[data-draft-id]").length;
      var counter = document.getElementById("pending-count");
      if (counter) counter.textContent = String(remaining);
      var queueCount = document.querySelector("h2 .count");
      if (queueCount) queueCount.textContent = String(remaining);
    }, 380);
  }
  document.addEventListener("click", function (event) {
    var button = event.target.closest("button[data-action]");
    if (!button) return;
    var card = button.closest(".card");
    if (!card) return;
    var action = button.getAttribute("data-action");
    var who = card.getAttribute("data-who") || "this lead";
    if (action === "approve" && !confirm("Send this reply to " + who + "?")) return;
    if (action === "reject" && !confirm("Reject this draft? Nothing will be sent.")) return;
    var payload = {};
    if (action === "approve") {
      payload.subject = card.querySelector("input[name=subject]").value;
      payload.body = card.querySelector("textarea[name=body]").value;
      if (!payload.body.trim()) { setStatus(card, "reply body is empty", "err"); return; }
    }
    card.querySelectorAll("button[data-action]").forEach(function (b) { b.disabled = true; });
    setStatus(card, action === "approve" ? "sending…" : "rejecting…");
    fetch("/dashboard/api/drafts/" + card.getAttribute("data-draft-id") + "/" + action, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (response) { return response.json().then(function (body) { return { ok: response.ok, body: body }; }); })
      .then(function (result) {
        if (result.ok) {
          setStatus(card, action === "approve" ? "sent ✓" : "rejected", "ok");
          finishCard(card);
        } else {
          setStatus(card, result.body && result.body.error ? result.body.error : "failed — try again", "err");
          enableButtons(card);
        }
      })
      .catch(function () {
        setStatus(card, "network error — try again", "err");
        enableButtons(card);
      });
  });

  /* ——— Operations ——— */
  document.querySelectorAll("button[data-ops]").forEach(function (button) {
    button.addEventListener("click", function () {
      var op = button.getAttribute("data-ops");
      var name = button.getAttribute("data-job-name") || undefined;
      var label = name || "ALL job types";
      var message = op === "retry"
        ? "Re-run the most recent failed \\"" + label + "\\" job now?"
        : "Clear failed jobs for " + label + "? This deletes their failure records (the schedules keep running).";
      if (!confirm(message)) return;
      button.disabled = true;
      fetch("/dashboard/api/ops/" + op, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name })
      }).then(function (response) {
        if (response.ok) location.reload();
        else { button.disabled = false; alert("Action failed — try again."); }
      }).catch(function () { button.disabled = false; alert("Network error — try again."); });
    });
  });

  /* ——— # updates unread dot ——— */
  var channel = document.getElementById("channel-updates");
  if (channel) {
    var latest = channel.getAttribute("data-latest");
    var seen = localStorage.getItem("lastSeen:updates") || "";
    var dot = channel.querySelector(".unread-dot");
    if (channel.classList.contains("sess-active")) {
      if (latest) localStorage.setItem("lastSeen:updates", latest);
    } else if (dot && latest && latest > seen) {
      dot.hidden = false;
    }
  }

  /* ——— Leads (CRM) filters ——— */
  var crmTable = document.getElementById("crm-table");
  if (crmTable) {
    var crmRows = Array.prototype.slice.call(crmTable.querySelectorAll("tbody tr"));
    var activeTag = "all";
    var textFilter = "";
    function applyCrm() {
      crmRows.forEach(function (row) {
        var tagOk = activeTag === "all" || (row.getAttribute("data-tags") || "").split(" ").indexOf(activeTag) !== -1;
        var textOk = !textFilter || (row.getAttribute("data-text") || "").indexOf(textFilter) !== -1;
        row.style.display = tagOk && textOk ? "" : "none";
      });
    }
    document.querySelectorAll(".crm-tab[data-crm-filter]").forEach(function (tab) {
      tab.addEventListener("click", function () {
        document.querySelectorAll(".crm-tab[data-crm-filter]").forEach(function (t) { t.classList.remove("sel"); });
        tab.classList.add("sel");
        activeTag = tab.getAttribute("data-crm-filter").replace(" ", "-");
        if (activeTag === "all") activeTag = "all";
        applyCrm();
      });
    });
    var crmSearch = document.getElementById("crm-search");
    if (crmSearch) {
      crmSearch.addEventListener("input", function () {
        textFilter = crmSearch.value.trim().toLowerCase();
        applyCrm();
      });
    }
  }

  /* ——— Message ledger row expansion ——— */
  document.querySelectorAll("[data-ledger-row]").forEach(function (row) {
    row.addEventListener("click", function (event) {
      if (event.target.closest("a,button,input,select")) return;
      var id = row.getAttribute("data-ledger-row");
      var detail = document.querySelector("[data-ledger-detail=\\"" + id + "\\"]");
      if (detail) detail.hidden = !detail.hidden;
    });
  });

  /* ——— Human-approved lessons ——— */
  document.querySelectorAll("button[data-lesson-status]").forEach(function (button) {
    button.addEventListener("click", function () {
      var id = button.getAttribute("data-lesson-id");
      var status = button.getAttribute("data-lesson-status");
      var label = status === "active" ? "activate" : status;
      if (!confirm(label.charAt(0).toUpperCase() + label.slice(1) + " this lesson? Active lessons change Bruno's future drafting guidance.")) return;
      button.disabled = true;
      fetch("/dashboard/api/lessons/" + encodeURIComponent(id) + "/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: status, confirmed: true })
      }).then(function (response) {
        if (response.ok) location.reload();
        else return response.json().then(function (body) { button.disabled = false; alert((body && body.error) || "Action failed."); });
      }).catch(function () { button.disabled = false; alert("Network error — try again."); });
    });
  });

  var lessonForm = document.querySelector("[data-lesson-form]");
  if (lessonForm) {
    lessonForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var lesson = lessonForm.querySelector("[name=lesson]").value.trim();
      var kind = lessonForm.querySelector("[name=kind]").value;
      if (!lesson) return;
      if (!confirm("Propose this as a lesson for review? It will not affect Bruno until it is activated.")) return;
      var button = lessonForm.querySelector("button[type=submit]");
      button.disabled = true;
      fetch("/dashboard/api/lessons", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lesson: lesson, kind: kind })
      }).then(function (response) {
        if (response.ok) location.reload();
        else return response.json().then(function (body) { button.disabled = false; alert((body && body.error) || "Action failed."); });
      }).catch(function () { button.disabled = false; alert("Network error — try again."); });
    });
  }

  /* ——— Confirmed campaign controls with an audit reason ——— */
  document.querySelectorAll("button[data-campaign-action]").forEach(function (button) {
    button.addEventListener("click", function () {
      var campaignId = button.getAttribute("data-campaign-id");
      var action = button.getAttribute("data-campaign-action");
      var campaignName = button.getAttribute("data-campaign-name");
      var reason = prompt("Why are you changing " + campaignName + "? This reason is saved in the audit log.");
      if (!reason || !reason.trim()) return;
      var body = { action: action, reason: reason.trim(), confirmed: true };
      if (action === "daily_limit") {
        var input = document.querySelector("[data-limit-input=\\"" + campaignId + "\\"]");
        var dailyLimit = Number(input && input.value);
        if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 500) {
          alert("Enter a daily limit from 1 to 500.");
          return;
        }
        body.dailyLimit = dailyLimit;
      }
      var exact = action === "pause" ? "pause" : action === "resume" ? "resume" : "change the daily limit for";
      if (!confirm("Confirm: " + exact + " " + campaignName + "?")) return;
      button.disabled = true;
      fetch("/dashboard/api/campaigns/" + encodeURIComponent(campaignId) + "/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      }).then(function (response) {
        if (response.ok) location.reload();
        else return response.json().then(function (result) { button.disabled = false; alert((result && result.error) || "Action failed."); });
      }).catch(function () { button.disabled = false; alert("Network error — try again."); });
    });
  });

  /* ——— Lead pipeline status ——— */
  var interestForm = document.querySelector("[data-interest-form]");
  if (interestForm) {
    interestForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var select = interestForm.querySelector("select");
      var status = select.value;
      if (!status) return;
      var label = select.options[select.selectedIndex].textContent;
      if (!confirm("Set this lead's pipeline status to \\"" + label + "\\" in Instantly?")) return;
      var statusEl = interestForm.querySelector(".action-status");
      statusEl.textContent = "updating…";
      fetch("/dashboard/api/lead/interest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: interestForm.getAttribute("data-email"), status: Number(status) })
      })
        .then(function (r) {
          if (r.ok) { statusEl.textContent = "updated ✓"; statusEl.className = "action-status mono ok"; setTimeout(function () { location.reload(); }, 700); }
          else return r.json().then(function (b) { statusEl.textContent = (b && b.error) || "failed"; statusEl.className = "action-status mono err"; });
        })
        .catch(function () { statusEl.textContent = "network error"; statusEl.className = "action-status mono err"; });
    });
  }

  /* ——— Cancel a queued follow-up ——— */
  var cancelForms = document.querySelectorAll("[data-cancel-retarget]");
  for (var ci = 0; ci < cancelForms.length; ci++) {
    (function (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        if (!confirm("Cancel the follow-up queued for this lead? Their sequence keeps running either way.")) return;
        var statusEl = form.querySelector(".action-status");
        statusEl.textContent = "cancelling…";
        fetch("/dashboard/api/retargets/" + encodeURIComponent(form.getAttribute("data-retarget")) + "/cancel", {
          method: "POST"
        })
          .then(function (r) {
            if (r.ok) { statusEl.textContent = "cancelled ✓"; statusEl.className = "action-status mono ok"; setTimeout(function () { location.reload(); }, 700); }
            else return r.json().then(function (b) { statusEl.textContent = (b && b.error) || "failed"; statusEl.className = "action-status mono err"; });
          })
          .catch(function () { statusEl.textContent = "network error"; statusEl.className = "action-status mono err"; });
      });
    })(cancelForms[ci]);
  }

  /* ——— Pause toggle ——— */
  var pauseButton = document.getElementById("pause-btn");
  if (pauseButton) {
    pauseButton.addEventListener("click", function () {
      var paused = pauseButton.getAttribute("data-paused") === "true";
      var verb = paused ? "Resume" : "Pause";
      if (!confirm(verb + " Bruno? " + (paused ? "He will start processing replies again." : "He will stop classifying and drafting until resumed."))) return;
      var reason = prompt("Why are you making this change? The reason is saved in the audit log.");
      if (!reason || !reason.trim()) return;
      pauseButton.disabled = true;
      fetch("/dashboard/api/agent/pause", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paused: !paused, reason: reason.trim(), confirmed: true })
      }).then(function (response) {
        if (response.ok) location.reload();
        else pauseButton.disabled = false;
      }).catch(function () { pauseButton.disabled = false; });
    });
  }
})();
</script>
</body>
</html>`;
}

export function renderMessagePage(title: string, message: string, statusHint?: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0c12; color: #f0f1f5; font-family: system-ui, sans-serif; }
  .box { max-width: 420px; padding: 32px; text-align: center; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  p { color: #b8bac6; font-size: 14px; line-height: 1.55; margin: 0; }
  .hint { margin-top: 14px; font-family: ui-monospace, monospace; font-size: 11px; color: #7d7f8e; letter-spacing: 0.08em; text-transform: uppercase; }
</style>
</head>
<body>
  <div class="box">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    ${statusHint ? `<div class="hint">${escapeHtml(statusHint)}</div>` : ""}
  </div>
</body>
</html>`;
}
