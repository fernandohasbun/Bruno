import Fastify from "fastify";
import cron from "node-cron";
import pino from "pino";
import { env } from "./config/env.js";
import { registerDashboard } from "./dashboard/routes.js";
import { closePool } from "./db/pool.js";
import { enqueueJob, enqueueJobIfIdle } from "./queue/queue.js";
import { startWorkerLoop } from "./queue/worker.js";
import { registerInstantlyWebhook } from "./webhooks/instantly.js";
import { registerSlackWebhook } from "./webhooks/slack.js";

const logger = pino({ name: "server" });
const app = Fastify({ logger: true });

// Preserve the raw JSON body so webhook signatures (e.g. Slack) can be verified
// against the exact bytes Slack signed, while still parsing JSON for handlers.
app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
  const raw = typeof body === "string" ? body : body.toString();
  (req as unknown as { rawBody?: string }).rawBody = raw;
  if (raw.length === 0) {
    done(null, {});
    return;
  }
  try {
    done(null, JSON.parse(raw));
  } catch (error) {
    done(error as Error);
  }
});

app.get("/health", async () => ({
  ok: true,
  service: "ai-sdr-agent",
  time: new Date().toISOString()
}));

await registerInstantlyWebhook(app);
await registerSlackWebhook(app);
await registerDashboard(app);

cron.schedule("*/5 * * * *", async () => {
  await enqueueJob("reply.poll", { scheduledAt: new Date().toISOString() });
});

// Hourly sweep for out-of-office windows that have closed. The retarget rows
// carry their own run_after, so the sweep only has to run often enough to catch
// them on the right morning.
cron.schedule("10 * * * *", async () => {
  await enqueueJobIfIdle("reply.retarget", { scheduledAt: new Date().toISOString() });
});

cron.schedule("*/2 * * * *", async () => {
  await enqueueJobIfIdle("crm.messages.sync", { scheduledAt: new Date().toISOString() });
});

cron.schedule("*/15 * * * *", async () => {
  await enqueueJobIfIdle("crm.leads.sync", { scheduledAt: new Date().toISOString() });
});

cron.schedule("20 * * * *", async () => {
  await enqueueJobIfIdle("crm.reconcile", { scheduledAt: new Date().toISOString() });
});

cron.schedule("*/15 * * * *", async () => {
  await enqueueJob("watchdog.check", { scheduledAt: new Date().toISOString() });
});

cron.schedule("55 23 * * *", async () => {
  await enqueueJob("metrics.rollup", { scheduledAt: new Date().toISOString() });
});

cron.schedule("0 8 * * 1-5", async () => {
  await enqueueJob("daily.digest", { scheduledAt: new Date().toISOString() });
});

cron.schedule("0 9 * * 1", async () => {
  await enqueueJob("weekly.analytics", { scheduledAt: new Date().toISOString() });
});

cron.schedule("15 9 * * 1", async () => {
  await enqueueJob("learning.review", { scheduledAt: new Date().toISOString() });
});

// Seed the read model immediately after a deployment; every job is idempotent.
await Promise.all([
  enqueueJobIfIdle("crm.leads.sync", { scheduledAt: new Date().toISOString(), trigger: "startup" }),
  enqueueJobIfIdle("crm.messages.sync", { scheduledAt: new Date().toISOString(), trigger: "startup" })
]);

const worker = startWorkerLoop();

const shutdown = async () => {
  logger.info("shutting down");
  worker.stop();
  await app.close();
  await closePool();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: env.PORT, host: "0.0.0.0" });
