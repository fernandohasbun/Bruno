# Dashboard audit — Inbox, Leads, Activity

**28 July 2026** · Why out-of-office replies vanished, what each page should answer, and a three-phase plan to connect them.

---

## Summary

Bruno's judgment lives in one table, `reply_classifications`. Exactly one page reads it.

Leads and Activity are straight mirrors of Instantly. They know a lead's sequence status, opens, and subject lines — but nothing Bruno concluded about them. That is why the pages feel disconnected: there is no column, key, or concept they share. A lead's provider state and Bruno's read of that lead never meet on the same screen, except on the per-lead detail page, which already does it correctly and is the model for the rest.

The vanishing auto-replies are the sharpest symptom. The Inbox sorts replies by matching intent against two hardcoded lists. `out_of_office` is in neither, so all eight fell through every section and became invisible.

---

## How the pages are wired today

| Page | Reads from | Question it answers | Bruno's read |
|---|---|---|---|
| **Inbox** <br>`routes.ts:613` | `reply_classifications` + `drafts` | Who replied, and what needs me? | 6 of 8 intents |
| **Leads** <br>`routes.ts:897` | `crm_leads` — Instantly mirror | Who is in the campaigns? | **none** |
| **Activity** <br>`routes.ts:960` | `crm_messages` — Instantly mirror | What was sent and received? | **none** |
| **Lead detail** <br>`routes.ts:779` | Both, joined on `lower(email)` | Everything about one person | full timeline |

> Lead detail already joins the two worlds in `getLeadActivity` (`db/dashboard.ts:190`). The join is trivial because `reply_classifications.email` and `crm_leads.email` are the same key. Nothing in the schema is blocking this — the list pages simply never ask.

---

## Findings

### 1. Intent routing is an allow-list, so new intents disappear silently

`routes.ts:312-313, 628-629` — **root cause**

The Inbox builds its three sections by testing membership in two arrays. Any intent absent from both, and not equal to `unclear`, renders nowhere at all — no error, no fallback, no count.

```text
HOT_INTENTS     = [positive, question, objection]   -> Waiting on you
HANDLED_INTENTS = [not_now, negative, unsubscribe]  -> Handled for you
intent === unclear && no draft                      -> Needs your read

out_of_office -> matches nothing -> renders nowhere
```

The other three findings are consequences of this, or of the same habit applied elsewhere. Adding a ninth intent later would fail the same way.

### 2. Eight auto-replies are now invisible

Relabelling those replies to `out_of_office` removed them from "Needs your read" without placing them anywhere else. They are correctly classified in the database and absent from the interface — the worst combination, because nothing signals anything is missing.

### 3. Two scheduled follow-ups have no screen at all

Follow-ups are queued for **30 July** and **3 August**. The `scheduled_retargets` table has no page, no count, and no cancel control. The only evidence they exist is console output, so there is no way to confirm the feature works until a draft either appears or doesn't.

### 4. Leads and Activity carry no judgment

`db/crm.ts:258`, `db/crm.ts:377`

Both paginate provider mirrors and stop there. Activity's filters are genuinely good — direction, sender, date, full-text — but every row is inert: you can find a message and still not know what Bruno made of it, or what happened next. Leads shows Instantly's `interest_status`, which is a provider field, not Bruno's conclusion.

---

## What each page should be for

| Page | Purpose |
|---|---|
| **Inbox** — the decision queue | Everything waiting on a human, and nothing else. Every reply lands in exactly one section, always. Success is reaching zero. |
| **Leads** — the roster | Every person, their provider state *and* Bruno's latest read side by side. The page you filter to ask "who is stalled, who is away, who never answered". |
| **Activity** — the evidence log | Exactly what was said, in order, with Bruno's conclusion attached to each inbound message. Where you go to answer "why did that happen". |
| **Lead detail** — the dossier | Already right. One person, full timeline, both data worlds joined. The other three pages are entry points into this one. |

The connective tissue is one idea: **a lead's latest classification travels with them everywhere.** Same label, same vocabulary, on every screen — so a status seen on Activity means the identical thing on Leads, and clicking either lands on the dossier.

---

## Plan

### Phase 1 — Make the Inbox exhaustive, and surface what's scheduled

*Scope: one file, plus a query.*

Replace the two allow-lists with a total mapping from intent to section, so every intent — present and future — is guaranteed a home. Add an **Away — following up** section listing auto-replies with their return dates and any queued follow-up.

- Route all 8 intents through one exhaustive `switch`; a missing case becomes a TypeScript error rather than a silent disappearance
- New section reads `scheduled_retargets` joined to its classification
- Per row: who, when they're back, whether a follow-up is queued, and a cancel control

**Fixes:** the eight invisible replies, and the two blind-scheduled follow-ups — before 30 July, when the first one fires.

### Phase 2 — Bruno's read as a column on Leads

*Scope: query + column + filter.*

Extend `listCrmLeadsPage` with a lateral join to each lead's most recent classification.

```sql
LEFT JOIN LATERAL (
  SELECT intent, ooo_return_date, created_at
  FROM reply_classifications rc
  WHERE lower(rc.email) = lower(l.email)
  ORDER BY rc.created_at DESC LIMIT 1
) bruno ON true
```

- New tabs: `away`, `needs read`, alongside today's replied / interested / in sequence
- Away rows show the return date inline, so the roster answers "who is back this week"

### Phase 3 — Attach the read to Activity rows

*Scope: query + badge + filter.*

Same join in `listCrmMessagesPage`, matched on lead and timestamp, so each received message carries the verdict it produced. Sent messages stay unlabelled — they have no intent.

- Intent badge on inbound rows, using the Inbox's vocabulary
- An intent filter beside the existing direction filter
- Expanded row gains Bruno's reasoning — the "why", next to the evidence

This turns the ledger from a log into a diagnostic: filter to `out_of_office` and read every auto-reply of the last month in one pass.

---

## How we'll know it worked

| Phase | Test | Expected |
|---|---|---|
| 1 | Open Inbox | All 8 auto-replies visible under "Away"; both follow-ups listed with dates |
| 1 | Add a fake 9th intent in a test | Compile fails rather than rendering nothing |
| 1 | Wait for 30 July, 08:10 | Laura's draft moves from "Away" to "Waiting on you" |
| 2 | Leads → `away` tab | Exactly the 8 relabelled leads, return dates shown |
| 3 | Activity → filter `out_of_office` | Every auto-reply, with reasoning in the expanded row |

> **Phase 1 has a deadline.** The first scheduled follow-up drafts on 30 July at 08:10. If the Inbox still cannot show `out_of_office`, that draft lands in a queue with no context for why it exists.
