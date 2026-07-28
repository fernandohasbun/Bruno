import crypto from "node:crypto";
import type { InstantlyEvent } from "../types/domain.js";

export function normalizeInstantlyEvent(body: unknown): InstantlyEvent {
  const payload = body as Record<string, unknown>;
  const data = (payload.data ?? payload) as Record<string, unknown>;

  const eventType = String(payload.event_type ?? payload.event ?? payload.type ?? inferEmailEventType(data));
  const providerEventId = String(payload.id ?? payload.event_id ?? data.id ?? data.message_id ?? contentHash(eventType, data));
  const bodyValue = data.body as Record<string, unknown> | undefined;
  const bodyText =
    typeof bodyValue?.text === "string"
      ? bodyValue.text
      : typeof bodyValue?.html === "string"
        ? stripHtml(bodyValue.html)
        : undefined;

  return {
    provider: "instantly",
    providerEventId,
    eventType,
    email: stringOrUndefined(data.email ?? data.lead_email ?? data.lead ?? data.from_address_email),
    companyName: stringOrUndefined(data.company ?? data.company_name),
    campaignId: stringOrUndefined(data.campaign_id),
    leadId: stringOrUndefined(data.lead_id ?? data.id),
    // Carried separately from the body: "Automatic reply:" / "Out of Office" in the
    // subject is the single strongest out-of-office signal we get.
    subject: stringOrUndefined(data.subject),
    threadText: stringOrUndefined(data.thread_text ?? data.reply_text ?? bodyText ?? data.content_preview ?? data.message),
    raw: payload
  };
}

function stringOrUndefined(value: unknown) {
  if (value === null || value === undefined) return undefined;
  return String(value);
}

function inferEmailEventType(data: Record<string, unknown>) {
  if (data.email_type === "received" || data.ue_type === 2) return "email.received";
  return "unknown";
}

function contentHash(eventType: string, data: Record<string, unknown>) {
  const stable = JSON.stringify(sortJson({ eventType, data }));
  return `${eventType}:${crypto.createHash("sha256").update(stable).digest("hex").slice(0, 24)}`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, sortJson(nested)])
  );
}

function stripHtml(html: string) {
  return html.replace(/<[^>]+>/g, " ");
}
