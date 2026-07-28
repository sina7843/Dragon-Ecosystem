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

/** The signed-in user's display identity, for the profile chip and dashboard greeting. */
export interface ProfileName {
  readonly username: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
}

const account = ref<AccountView | null>(null);
const profileComplete = ref(false);
const profile = ref<ProfileName | null>(null);
const loaded = ref(false);

export function useAuth(): {
  account: Ref<AccountView | null>;
  authenticated: ComputedRef<boolean>;
  profileComplete: Ref<boolean>;
  profile: Ref<ProfileName | null>;
  /** displayName, falling back to username, falling back to null. */
  displayName: ComputedRef<string | null>;
  loaded: Ref<boolean>;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
} {
  async function refresh(): Promise<void> {
    try {
      const session = await apiFetch<SessionResponse>('/auth/session');
      account.value = session.authenticated ? (session.account ?? null) : null;
      profileComplete.value = session.profileComplete;
      // Best-effort name for the chrome; a missing profile (404) simply leaves it null.
      if (session.authenticated) {
        try {
          const p = await apiFetch<ProfileName>('/account/profile');
          profile.value = { username: p.username, displayName: p.displayName, avatarUrl: p.avatarUrl ?? null };
        } catch {
          profile.value = null;
        }
      } else {
        profile.value = null;
      }
    } catch {
      // An unreachable API is treated as signed out rather than breaking the shell.
      account.value = null;
      profileComplete.value = false;
      profile.value = null;
    } finally {
      loaded.value = true;
    }
  }

  async function signOut(): Promise<void> {
    await apiFetch<void>('/auth/logout', { method: 'POST' });
    account.value = null;
    profileComplete.value = false;
    profile.value = null;
  }

  return {
    account,
    authenticated: computed(() => account.value !== null),
    profileComplete,
    profile,
    displayName: computed(() => {
      const p = profile.value;
      if (p === null) return null;
      return p.displayName.trim() !== '' ? p.displayName : p.username.trim() !== '' ? p.username : null;
    }),
    loaded,
    refresh,
    signOut
  };
}
