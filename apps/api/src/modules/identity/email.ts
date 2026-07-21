/**
 * Email provider boundary (OD-003, INT-003, AUTH-005).
 *
 * OD-003 is unresolved: no transactional email provider has been approved, so
 * delivery is disabled. The adapter boundary exists so a provider can be added
 * later without touching domain logic, and the disabled implementation makes the
 * gated state explicit rather than silently dropping messages.
 *
 * AUTH-005 also holds independently: an unverified address may never be used.
 */

export interface EmailMessage {
  readonly to: string;
  readonly template: string;
  readonly locale: string;
  readonly correlationId: string;
}

export type EmailOutcome = 'suppressed_provider_not_approved';

export interface EmailAdapter {
  send(message: EmailMessage): Promise<EmailOutcome>;
  readonly enabled: boolean;
}

/** The only implementation while OD-003 is open. */
export const disabledEmailAdapter: EmailAdapter = {
  enabled: false,
  async send(): Promise<EmailOutcome> {
    // No provider is approved, so nothing is sent and nothing is queued.
    return 'suppressed_provider_not_approved';
  }
};
