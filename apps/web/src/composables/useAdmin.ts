import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { ApiRequestError, apiFetch } from '../api.ts';
import { useAuth } from './useAuth.ts';

/**
 * Administration capabilities for the current user.
 *
 * The navigation and controls are generated from the server's effective-permission
 * list (section 9.4). Hiding a control is never the authorization boundary — the
 * server enforces it — but it keeps the UI honest about what the user can do.
 */

interface CapabilitiesResponse {
  permissions: string[];
  isSuperAdmin: boolean;
}

const permissions = ref<Set<string>>(new Set());
const isSuperAdmin = ref(false);
const loaded = ref(false);
const forbidden = ref(false);
/** Shared in-flight probe, so a shell and a view mounting together issue one request. */
let inFlight: Promise<void> | null = null;
/**
 * Account the current result was probed for. Every admin view calls `refresh()` on mount
 * defensively, so without this a repeat mount re-requests capabilities that cannot have
 * changed. Keying on the identity keeps the result correct across sign-in and sign-out:
 * a different (or absent) account always re-probes.
 */
let probedFor: string | null | undefined;

export function useAdmin(): {
  loaded: Ref<boolean>;
  forbidden: Ref<boolean>;
  isSuperAdmin: Ref<boolean>;
  has: (permission: string) => boolean;
  canReadUsers: ComputedRef<boolean>;
  canReadAudit: ComputedRef<boolean>;
  canReadConfig: ComputedRef<boolean>;
  canWriteContent: ComputedRef<boolean>;
  /** Gates the media library, which is the same permission its endpoints require. */
  canPublishContent: ComputedRef<boolean>;
  /** Gates the notification templates + delivery console and the support console. */
  canManageSupport: ComputedRef<boolean>;
  /** Gates the finance console. Approving a payout needs `finance.approve` on top. */
  canManageFinance: ComputedRef<boolean>;
  /** Gates the operations dashboard (alerts, jobs, metrics). */
  canManageOps: ComputedRef<boolean>;
  canManageGames: ComputedRef<boolean>;
  /** Gates the stream operations console (ROLE-024). */
  canManageStreams: ComputedRef<boolean>;
  /** Gates the chat moderation console (ROLE-013). */
  canModerateChat: ComputedRef<boolean>;
  /** Gates the education console (ROLE-023). */
  canManageEducation: ComputedRef<boolean>;
  canManageTournaments: ComputedRef<boolean>;
  canManageModeration: ComputedRef<boolean>;
  refresh: () => Promise<void>;
} {
  const { account } = useAuth();

  function refresh(): Promise<void> {
    const identity = account.value?.id ?? null;
    // Already answered for this identity: reuse it instead of re-asking on every mount.
    if (loaded.value && probedFor === identity) return Promise.resolve();
    inFlight ??= load(identity).finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  async function load(identity: string | null): Promise<void> {
    probedFor = identity;
    try {
      const caps = await apiFetch<CapabilitiesResponse>('/admin/capabilities');
      permissions.value = new Set(caps.permissions);
      isSuperAdmin.value = caps.isSuperAdmin;
      forbidden.value = false;
    } catch (error) {
      // A non-admin (403) or anonymous (401) caller sees the forbidden state.
      permissions.value = new Set();
      isSuperAdmin.value = false;
      forbidden.value = error instanceof ApiRequestError && (error.status === 403 || error.status === 401);
    } finally {
      loaded.value = true;
    }
  }

  // A super admin holds every capability implicitly — the server grants it access
  // without listing each granular permission, so the UI must mirror that.
  function has(permission: string): boolean {
    return isSuperAdmin.value || permissions.value.has(permission);
  }

  return {
    loaded,
    forbidden,
    isSuperAdmin,
    has,
    canReadUsers: computed(() => has('users.read')),
    canReadAudit: computed(() => has('audit.read')),
    canReadConfig: computed(() => has('config.read')),
    canWriteContent: computed(() => has('content.write')),
    canPublishContent: computed(() => has('content.publish')),
    canManageSupport: computed(() => has('support.manage')),
    canManageFinance: computed(() => has('finance.manage')),
    // Operations shares the support-operator permission its endpoints already require.
    canManageOps: computed(() => has('support.manage')),
    canManageGames: computed(() => has('games.manage')),
    canManageStreams: computed(() => has('stream.manage')),
    canModerateChat: computed(() => has('chat.moderate')),
    canManageEducation: computed(() => has('education.manage')),
    canManageTournaments: computed(() => has('tournament.manage')),
    canManageModeration: computed(() => has('moderation.manage')),
    refresh
  };
}
