import { readonly, ref, type DeepReadonly, type Ref } from 'vue';

/**
 * Notification centre for transient status messages (NOTIF-*, A11Y-016).
 *
 * Messages are rendered in one polite live region. The queue is capped so a
 * burst of updates cannot flood assistive technology with announcements.
 */

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export interface Toast {
  readonly id: number;
  readonly tone: ToastTone;
  /** Already-localized text: callers pass `t(...)`, never a raw key. */
  readonly message: string;
}

export const MAX_VISIBLE_TOASTS = 3;

const toasts = ref<Toast[]>([]);
let nextId = 1;

export function useToasts(): {
  toasts: DeepReadonly<Ref<Toast[]>>;
  push: (tone: ToastTone, message: string) => number;
  dismiss: (id: number) => void;
  clear: () => void;
} {
  function push(tone: ToastTone, message: string): number {
    const id = nextId++;
    // Oldest messages drop out first once the cap is reached.
    const next = [...toasts.value, { id, tone, message }];
    toasts.value = next.slice(-MAX_VISIBLE_TOASTS);
    return id;
  }

  function dismiss(id: number): void {
    toasts.value = toasts.value.filter((toast) => toast.id !== id);
  }

  function clear(): void {
    toasts.value = [];
  }

  return { toasts: readonly(toasts), push, dismiss, clear };
}
