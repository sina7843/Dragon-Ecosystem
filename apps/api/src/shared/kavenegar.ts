/**
 * Minimal Kavenegar REST client (https://kavenegar.com/rest.html).
 *
 * Two calls are used:
 * - `verify/lookup` for OTP: sends a code as a `token` inside a pre-approved `template`,
 *   so the OTP body is never free text (SMS-001).
 * - `sms/send` for notifications: a plain message on an approved sender line.
 *
 * Both return a boolean and never throw for a delivery/network failure, so a provider
 * outage degrades to a "failed" delivery record rather than crashing a request. The API
 * key lives only in the URL to Kavenegar and is never logged.
 */

/** Kavenegar wraps every response in `{ return: { status, message }, entries }`. Status 200 = accepted. */
interface KavenegarEnvelope {
  return?: { status?: number; message?: string };
  entries?: unknown;
}

const BASE = 'https://api.kavenegar.com/v1';
const TIMEOUT_MS = 8000;

async function call(url: string, label: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // GET is accepted by every Kavenegar method; parameters are already URL-encoded by the caller.
    const response = await fetch(url, { method: 'GET', signal: controller.signal });
    const body = (await response.json().catch(() => null)) as KavenegarEnvelope | null;
    const status = body?.return?.status;
    if (response.ok && status === 200) return true;
    // The message may carry a Kavenegar reason (bad template, no credit); the key is never in it.
    console.warn(`[kavenegar] ${label} not accepted: http=${response.status} return=${String(status)} ${body?.return?.message ?? ''}`.trim());
    return false;
  } catch (error) {
    console.warn(`[kavenegar] ${label} request failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** OTP delivery via an approved template. Returns true when Kavenegar accepted the message. */
export function kavenegarVerifyLookup(input: { apiKey: string; receptor: string; token: string; template: string }): Promise<boolean> {
  const q = new URLSearchParams({ receptor: input.receptor, token: input.token, template: input.template });
  return call(`${BASE}/${encodeURIComponent(input.apiKey)}/verify/lookup.json?${q.toString()}`, 'verify/lookup');
}

/** Plain-message SMS (notifications). `sender` is optional; empty lets Kavenegar pick the default line. */
export function kavenegarSmsSend(input: { apiKey: string; sender: string; receptor: string; message: string }): Promise<boolean> {
  const params: Record<string, string> = { receptor: input.receptor, message: input.message };
  if (input.sender !== '') params['sender'] = input.sender;
  const q = new URLSearchParams(params);
  return call(`${BASE}/${encodeURIComponent(input.apiKey)}/sms/send.json?${q.toString()}`, 'sms/send');
}
