# AI SDR Agent

Local scaffold for the always-on AI SDR operations layer.

## Architecture

```text
Apollo -> Instantly -> Webhooks -> Postgres queue -> Workers
                                             |
                                             v
                         Claude + Instantly CRM + Slack + Postgres
```

The backend does not send new cold email directly. Instantly owns sequencing, delivery, replies, and transactional CRM state. Bruno synchronizes a queryable read model and exact message ledger into Postgres, then handles reply classification, approval-gated drafts, metrics, learning, and reliability.

## What Is In This Scaffold

- TypeScript backend with Fastify
- Postgres schema
- Postgres-backed job queue
- Instantly webhook endpoint
- Worker loop with retry-safe processing
- Claude wrapper
- Instantly / Apollo / Slack integration wrappers
- Agent modules for scoring, reply intent, drafting, analytics
- Complete, paginated CRM lead mirror and exact sent/received message ledger
- Reconciliation checks against Instantly with sync health in the owner console
- Human-approved learning from recurring owner edits
- Confirm-gated, audited campaign pause/resume and daily-limit controls
- Private dashboard at `/dashboard`
- Mock webhook payloads
- `.env.example`

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env`:

```bash
cp .env.example .env
```

3. Start Postgres locally and create the database named `ai_sdr_agent`.

4. Run migrations:

```bash
npm run migrate
```

5. Start the dev server:

```bash
npm run dev
```

6. Open the private console:

```text
http://localhost:3000/dashboard?key=YOUR_DASHBOARD_SECRET
```

The first successful login stores an HttpOnly dashboard cookie. The dashboard has Inbox, Leads, Activity, Campaign, Learning, and System views.

7. Test a mock Instantly reply:

```bash
curl -X POST http://localhost:3000/webhooks/instantly \
  -H "content-type: application/json" \
  --data @mock-payloads/instantly-reply.json
```

## Docker

Build the production image:

```bash
docker build -t ai-sdr-agent .
```

Run it:

```bash
docker run --env-file .env -p 3000:3000 ai-sdr-agent
```

Railway should use the included `Dockerfile` via `railway.json`. The same container can be moved later to Fly.io, Google Cloud Run, AWS, or a VPS.

On every production start, `npm start` applies all idempotent migrations before the server listens. The server then queues singleton lead and message backfills automatically. Lead sync refreshes every 15 minutes; message sync every 2 minutes; reconciliation runs hourly. These jobs are lock-protected so deploys or long backfills cannot run duplicate scans concurrently.

## Verification

```bash
npm test
npm run typecheck
npm run build
```

The unit suite protects exact message normalization, safe reply HTML conversion, and the approved five-persona campaign schedule/link invariants.

## Current Boundary

The app is deployment-ready for Railway through the included Docker and service configuration. Instantly remains the source of truth; Postgres is Bruno's synchronized operational memory and can be rebuilt from the provider.

## Production Rules

- Webhooks should acknowledge quickly.
- Events should be stored before processing.
- Jobs should be retried safely.
- Claude should only handle judgment tasks.
- Instantly remains the CRM/source of truth for leads and outreach state.
- Postgres stores operational memory.
- The private dashboard and Bruno chat are the owner control center.
- Learned rules remain inert until an owner activates them.
- Every campaign or kill-switch mutation requires confirmation and is written to the action audit.
