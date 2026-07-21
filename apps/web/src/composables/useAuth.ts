import { computed, ref, type ComputedRef, type Ref } from 'vue';
import { apiFetch } from '../api.ts';

/**
 * Session state for the browser.
 *
 * The session itself lives in an httpOnly cookie the script cannot read, so this
 * only mirrors what the server reports.
 */

export interface AccountView {
  readonly id: string;
  readonly state: string;
  readonly locale: string;
  readonly timeZone: string;
}

interface SessionResponse {
  authenticated: boolean;
  profileComplete: boolean;
  account?: AccountView;
}

const account = ref<AccountView | null>(null);
const profileComplete = ref(false);
const loaded = ref(false);

export function useAuth(): {
  account: Ref<AccountView | null>;
  authenticated: ComputedRef<boolean>;
  profileComplete: Ref<boolean>;
  loaded: Ref<boolean>;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
} {
  async function refresh(): Promise<void> {
    try {
      const session = await apiFetch<SessionResponse>('/auth/session');
      account.value = session.authenticated ? (session.account ?? null) : null;
      profileComplete.value = session.profileComplete;
    } catch {
      // An unreachable API is treated as signed out rather than breaking the shell.
      account.value = null;
      profileComplete.value = false;
    } finally {
      loaded.value = true;
    }
  }

  async function signOut(): Promise<void> {
    await apiFetch<void>('/auth/logout', { method: 'POST' });
    account.value = null;
    profileComplete.value = false;
  }

  return {
    account,
    authenticated: computed(() => account.value !== null),
    profileComplete,
    loaded,
    refresh,
    signOut
  };
}
