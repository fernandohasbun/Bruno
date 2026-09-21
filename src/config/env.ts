import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),

  DATABASE_URL: z.string().min(1),

  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_FAST_MODEL: z.string().default("claude-haiku-4-5"),
  CLAUDE_STRONG_MODEL: z.string().default("claude-haiku-4-5"),

  INSTANTLY_API_KEY: z.string().optional(),
  INSTANTLY_WEBHOOK_SECRET: z.string().optional(),

  APOLLO_API_KEY: z.string().optional(),

  DASHBOARD_SECRET: z.string().min(16).optional(),

  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),
  SLACK_CHANNEL_HOT_REPLIES: z.string().default("agent-hot-replies"),
  SLACK_CHANNEL_APPROVALS: z.string().default("agent-approvals"),
  SLACK_CHANNEL_DAILY_DIGEST: z.string().default("agent-daily-digest"),
  SLACK_CHANNEL_ERRORS: z.string().default("agent-errors"),
  SLACK_CHANNEL_ANALYTICS: z.string().default("agent-analytics"),

  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(3),
  ENABLE_BACKGROUND_JOBS: z.enum(["true", "false"]).default("true").transform((value) => value === "true")
});

export const env = envSchema.parse(process.env);

export const isProduction = env.NODE_ENV === "production";
