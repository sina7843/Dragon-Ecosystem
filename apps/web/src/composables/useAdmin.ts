import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { ApiRequestError, apiFetch } from '../api.ts';

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

export function useAdmin(): {
  loaded: Ref<boolean>;
  forbidden: Ref<boolean>;
  isSuperAdmin: Ref<boolean>;
  has: (permission: string) => boolean;
  canReadUsers: ComputedRef<boolean>;
  canReadAudit: ComputedRef<boolean>;
  canReadConfig: ComputedRef<boolean>;
  canWriteContent: ComputedRef<boolean>;
  canManageGames: ComputedRef<boolean>;
  canManageTournaments: ComputedRef<boolean>;
  canManageModeration: ComputedRef<boolean>;
  refresh: () => Promise<void>;
} {
  async function refresh(): Promise<void> {
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

  function has(permission: string): boolean {
    return permissions.value.has(permission);
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
    canManageGames: computed(() => has('games.manage')),
    canManageTournaments: computed(() => has('tournament.manage')),
    canManageModeration: computed(() => has('moderation.manage')),
    refresh
  };
}
