<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import AppShell, { type ShellVariant } from './components/AppShell.vue';

// The route decides which shell wraps the view, so shell selection lives in one place.
const route = useRoute();
const shell = computed<ShellVariant>(() => route.meta.shell ?? 'public');
</script>

<template>
  <AppShell :variant="shell">
    <RouterView />
  </AppShell>
</template>
