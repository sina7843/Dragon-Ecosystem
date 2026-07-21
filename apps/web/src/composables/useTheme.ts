import { computed, ref, type ComputedRef, type Ref } from 'vue';
import {
  DEFAULT_THEME_MODE,
  readStoredThemeMode,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemeMode
} from '../theme/theme.ts';

/**
 * Applies the light/dark theme to the document and remembers the choice.
 * The resolution rule itself lives in theme/theme.ts and is unit tested.
 */

const DARK_QUERY = '(prefers-color-scheme: dark)';

const mode = ref<ThemeMode>(DEFAULT_THEME_MODE);
const prefersDark = ref(false);
let initialised = false;

function apply(): void {
  const root = globalThis.document?.documentElement;
  if (root === undefined) return;
  root.dataset['theme'] = resolveTheme(mode.value, prefersDark.value);
}

function readStored(): string | null {
  try {
    return globalThis.localStorage?.getItem(THEME_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Called once at startup, before the app mounts, so there is no theme flash. */
export function initTheme(): void {
  if (initialised) return;
  initialised = true;

  mode.value = readStoredThemeMode(readStored());
  const query = globalThis.matchMedia?.(DARK_QUERY);
  prefersDark.value = query?.matches ?? false;
  // Keep following the system while the user stays on "system".
  query?.addEventListener('change', (event) => {
    prefersDark.value = event.matches;
    apply();
  });
  apply();
}

export function useTheme(): {
  mode: Ref<ThemeMode>;
  resolved: ComputedRef<ResolvedTheme>;
  setMode: (next: ThemeMode) => void;
} {
  function setMode(next: ThemeMode): void {
    mode.value = next;
    try {
      globalThis.localStorage?.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // A failed preference write must never break the UI.
    }
    apply();
  }

  return {
    mode,
    resolved: computed(() => resolveTheme(mode.value, prefersDark.value)),
    setMode
  };
}
