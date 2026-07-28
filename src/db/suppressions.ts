import { pool } from "./pool.js";

/** True once a contact has bounced, unsubscribed, or been marked negative. */
export async function isSuppressed(email?: string) {
  if (!email) return false;
  const result = await pool.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM suppression_events WHERE lower(email) = lower($1)) AS exists",
    [email]
  );
  return result.rows[0]?.exists ?? false;
}

export async function saveSuppression(input: {
  email?: string;
  provider?: string;
  providerLeadId?: string;
  reason: string;
  rawPayload?: unknown;
}) {
  await pool.query(
    `
      INSERT INTO suppression_events (
        email,
        provider,
        provider_lead_id,
        reason,
        raw_payload
      )
      VALUES ($1, $2, $3, $4, $5::jsonb)
    `,
    [
      input.email,
      input.provider,
      input.providerLeadId,
      input.reason,
      JSON.stringify(input.rawPayload ?? {})
    ]
  );
}
