<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';

export interface NavItem {
  readonly to: string;
  /** Already-localized label. */
  readonly label: string;
}

const props = defineProps<{
  items: readonly NavItem[];
  /** Named `regionLabel` rather than `ariaLabel` so it is a prop, not a passthrough attribute. */
  regionLabel: string;
  openLabel: string;
  closeLabel: string;
  /** Compact rail density for administration navigation (section 22.2). */
  dense?: boolean;
}>();

const expanded = ref(false);
const toggle = ref<HTMLButtonElement | null>(null);
const route = useRoute();

// Navigating must not leave the mobile drawer open over the new page.
watch(() => route.fullPath, () => {
  expanded.value = false;
});

function onKeydown(event: KeyboardEvent): void {
  // Escape closes the disclosure and returns focus to the toggle, so the keyboard user is
  // never stranded on a link that just collapsed to display:none.
  if (event.key === 'Escape' && expanded.value) {
    expanded.value = false;
    toggle.value?.focus();
  }
}
</script>

<template>
  <nav
    :aria-label="props.regionLabel"
    :class="['app-nav', { dense: props.dense }]"
    @keydown="onKeydown"
  >
    <!-- Collapses into a disclosure below the tablet breakpoint (section 22.2). -->
    <button
      ref="toggle"
      type="button"
      class="toggle"
      data-testid="nav-toggle"
      :aria-expanded="expanded"
      aria-controls="app-nav-list"
      @click="expanded = !expanded"
    >
      {{ expanded ? props.closeLabel : props.openLabel }}
    </button>

    <ul
      id="app-nav-list"
      class="list"
      data-testid="nav-list"
      :data-expanded="expanded"
    >
      <li
        v-for="item in props.items"
        :key="item.to"
      >
        <RouterLink :to="item.to">
          {{ item.label }}
        </RouterLink>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.app-nav {
  position: relative;
}

.toggle {
  display: inline-flex;
  align-items: center;
  padding-inline: var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface-sunken);
  color: var(--color-text);
  font-family: var(--font-display);
  font-variation-settings: 'wdth' var(--display-width);
  font-weight: var(--weight-bold);
  font-size: var(--text-sm);
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
  cursor: pointer;
}
[lang='fa'] .toggle {
  font-family: var(--font-sans);
  font-variation-settings: normal;
  letter-spacing: normal;
  text-transform: none;
  font-size: var(--text-md);
}

.list {
  display: none;
  list-style: none;
  margin: 0;
  padding: 0;
  gap: var(--space-2);
}

.list[data-expanded='true'] {
  display: flex;
  flex-direction: column;
  position: absolute;
  inset-block-start: calc(100% + var(--space-2));
  inset-inline-start: 0;
  z-index: var(--z-drawer);
  min-inline-size: 13rem;
  padding: var(--space-3);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  background-color: var(--color-surface-raised);
  box-shadow: var(--glass-highlight), var(--shadow-lg);
}

.list a {
  display: flex;
  align-items: center;
  padding: var(--space-2) var(--space-3);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  text-decoration: none;
  /* Nav links are text-coloured; the accent is reserved for the active item. */
  color: var(--color-text-soft);
  font-family: var(--font-display);
  font-variation-settings: 'wdth' var(--display-width);
  font-weight: var(--weight-bold);
  font-size: var(--text-sm);
  letter-spacing: var(--tracking-wide);
  text-transform: uppercase;
  /* Keeps the touch target adequate on mobile (A11Y-012). */
  min-block-size: var(--target-min);
  transition:
    color var(--motion-fast) var(--motion-ease),
    background-color var(--motion-fast) var(--motion-ease),
    border-color var(--motion-fast) var(--motion-ease);
}

/* Tracking and casing break Arabic connected script — reset both (17.5). */
[lang='fa'] .list a {
  font-family: var(--font-sans);
  font-variation-settings: normal;
  letter-spacing: normal;
  text-transform: none;
  font-size: var(--text-md);
}

.list a:hover {
  color: var(--color-text);
  background-color: var(--color-surface-sunken);
}

/* The current item takes a soft gold fill and a lit edge. */
.list a.router-link-active {
  color: var(--color-accent);
  background-color: var(--color-primary-soft);
  border-color: var(--color-border-strong);
  /* Non-colour cue: an inset marker on the leading edge (section 23.2). */
  box-shadow: inset 0.2rem 0 0 var(--color-accent);
}

/* Tablet and wider: the disclosure disappears and the links sit inline. */
@media (min-width: 768px) {
  .toggle {
    display: none;
  }

  .list,
  .list[data-expanded='true'] {
    display: flex;
    flex-direction: row;
    position: static;
    padding: 0;
    border: 0;
    box-shadow: none;
    background-color: transparent;
    min-inline-size: 0;
  }

  /* Inline items keep the soft fill; the non-colour cue moves to a lit underline. */
  .list a.router-link-active {
    box-shadow: inset 0 -2px 0 var(--color-accent);
  }

  .app-nav.dense .list a {
    padding-block: var(--space-1);
    font-size: var(--text-sm);
  }
}
</style>
