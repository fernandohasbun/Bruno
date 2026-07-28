import pino from "pino";
import { env } from "../config/env.js";
import { claimNextJob, completeJob, failJob, type QueueJob } from "./queue.js";
import { processInstantlyEventJob } from "../jobs/processInstantlyEvent.js";
import { processDailyDigestJob } from "../jobs/processDailyDigest.js";
import { processWeeklyAnalyticsJob } from "../jobs/processWeeklyAnalytics.js";
import { processOutboundAgentReplyJob } from "../jobs/processOutboundAgentReply.js";
import { processReplyPollJob } from "../jobs/processReplyPoll.js";
import { processReplyRetargetJob } from "../jobs/processReplyRetarget.js";
import { processMetricsRollupJob } from "../jobs/processMetricsRollup.js";
import { processWatchdogJob } from "../jobs/processWatchdog.js";
import {
  processCrmLeadSyncJob,
  processCrmMessageSyncJob,
  processCrmReconcileJob
} from "../jobs/processCrmSync.js";
import { processLearningReviewJob } from "../jobs/processLearningReview.js";
import { postSlackReply } from "../integrations/slack.js";
import { notifyAlert } from "../integrations/notify.js";

const logger = pino({ name: "worker" });

export async function processJob(job: QueueJob) {
  switch (job.name) {
    case "instantly.event.received":
      await processInstantlyEventJob(job);
      return;
    case "reply.poll":
      await processReplyPollJob(job);
      return;
    case "reply.retarget":
      await processReplyRetargetJob(job);
      return;
    case "metrics.rollup":
      await processMetricsRollupJob(job);
      return;
    case "watchdog.check":
      await processWatchdogJob(job);
      return;
    case "daily.digest":
      await processDailyDigestJob(job);
      return;
    case "weekly.analytics":
      await processWeeklyAnalyticsJob(job);
      return;
    case "learning.review":
      await processLearningReviewJob(job);
      return;
    case "crm.leads.sync":
      await processCrmLeadSyncJob(job);
      return;
    case "crm.messages.sync":
      await processCrmMessageSyncJob(job);
      return;
    case "crm.reconcile":
      await processCrmReconcileJob(job);
      return;
    case "outbound.agent.reply":
      await processOutboundAgentReplyJob(job);
      return;
    case "reply.classify":
    case "lead.score":
      logger.info({ jobId: job.id, jobName: job.name }, "job type reserved for future direct processing");
      return;
    default:
      throw new Error(`Unhandled job: ${String(job.name)}`);
  }
}

export function startWorkerLoop() {
  let stopped = false;

  async function tick() {
    if (stopped) return;

    const jobs = await Promise.all(
      Array.from({ length: env.WORKER_CONCURRENCY }, () => claimNextJob())
    );

    await Promise.all(
      jobs
        .filter((job): job is QueueJob => job !== null)
        .map(async (job) => {
          try {
            logger.info({ jobId: job.id, jobName: job.name }, "processing job");
            await processJob(job);
            await completeJob(job.id);
          } catch (error) {
            logger.error({ error, jobId: job.id, jobName: job.name }, "job failed");
            const { willRetry } = await failJob(job, error);
            if (!willRetry) {
              await notifyTerminalFailure(job, error);
            }
          }
        })
    );
  }

  const interval = setInterval(() => {
    tick().catch((error) => logger.error({ error }, "worker tick failed"));
  }, env.WORKER_POLL_INTERVAL_MS);

  return {
    stop() {
      stopped = true;
      clearInterval(interval);
    }
  };
}

async function notifyTerminalFailure(job: QueueJob, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await notifyAlert(`Job failed permanently: ${job.name} (${job.id}) after ${job.attempts}/${job.maxAttempts} attempts.\n${message}`);

  if (job.name !== "outbound.agent.reply") return;
  const payload = job.payload as { channel?: string; threadTs?: string };
  if (payload.channel) {
    await postSlackReply(payload.channel, "I hit an internal error while answering that. The failure was posted to #agent-errors.", payload.threadTs);
  }
}
