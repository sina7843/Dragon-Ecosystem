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
  border-radius: var(--radius-md);
  background-color: var(--color-surface-raised);
  color: var(--color-text);
  cursor: pointer;
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
  min-inline-size: 12rem;
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface-raised);
  box-shadow: var(--shadow-md);
}

.list a {
  display: block;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  text-decoration: none;
  /* Keeps the touch target adequate on mobile (A11Y-012). */
  min-block-size: var(--target-min);
}

.list a:hover {
  background-color: var(--color-surface-sunken);
}

.list a.router-link-active {
  font-weight: 700;
  background-color: var(--color-surface-sunken);
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

  .app-nav.dense .list a {
    padding-block: var(--space-1);
    font-size: var(--text-sm);
  }
}
</style>
