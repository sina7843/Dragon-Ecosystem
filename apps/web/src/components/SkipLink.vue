<script setup lang="ts">
import { useI18n } from 'vue-i18n';

// A11Y-013: repeated-navigation layouts must offer a skip link.
const { t } = useI18n();
</script>

<template>
  <a
    class="skip-link"
    href="#main-content"
  >
    {{ t('nav.skipToContent') }}
  </a>
</template>

<style scoped>
.skip-link {
  position: absolute;
  inset-block-start: var(--space-2);
  inset-inline-start: var(--space-2);
  z-index: var(--z-toast);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  background-color: var(--color-accent);
  color: var(--color-accent-text);
  font-weight: 600;
  /* Hidden until focused, but always reachable by keyboard. */
  transform: translateY(-200%);
  transition: transform var(--motion-fast) var(--motion-ease);
}

.skip-link:focus-visible {
  transform: translateY(0);
}
</style>
