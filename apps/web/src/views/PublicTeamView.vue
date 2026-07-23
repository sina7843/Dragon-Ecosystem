<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import StateBlock from '../components/StateBlock.vue';
import { ApiRequestError } from '../api.ts';
import { getPublicTeam, type PublicTeam } from '../composables/useTeamsApi.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';

/** Privacy-aware public team page. A private or disbanded team is a real 404 (TEAM, section 16.4). */

const { t } = useI18n();
const { messageFor } = useApiErrors();
const route = useRoute();

const loading = ref(true);
const notFound = ref(false);
const errorMessage = ref<string | undefined>(undefined);
const team = ref<PublicTeam | null>(null);

onMounted(async () => {
  try {
    team.value = await getPublicTeam(String(route.params['slug']));
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) notFound.value = true;
    else errorMessage.value = messageFor(error);
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <section>
    <StateBlock
      v-if="loading"
      variant="loading"
    />
    <StateBlock
      v-else-if="notFound"
      variant="notFound"
      data-testid="team-not-found"
      :message="t('teams.public.notFound')"
    />
    <StateBlock
      v-else-if="errorMessage"
      variant="error"
      :message="errorMessage"
    />

    <template v-else-if="team">
      <div class="hero">
        <div class="hero-top">
          <span
            class="avatar"
            aria-hidden="true"
          >{{ team.name.slice(0, 2).toUpperCase() }}</span>
          <div class="hero-title">
            <h1>{{ team.name }}</h1>
            <span class="status-pill status-pill-info">{{ t('teams.visibility.public') }}</span>
          </div>
        </div>
        <p
          v-if="team.description"
          class="description"
        >
          {{ team.description }}
        </p>
      </div>

      <section class="block">
        <div class="section-header">
          <h2>{{ t('teams.public.roster') }}</h2>
        </div>
        <StateBlock
          v-if="team.members.length === 0"
          variant="empty"
          :message="t('teams.public.empty')"
        />
        <ul
          v-else
          class="roster"
          data-testid="public-roster"
        >
          <li
            v-for="member in team.members"
            :key="member.accountId"
          >
            <span
              class="avatar avatar-sm"
              aria-hidden="true"
            >{{ (member.displayName ?? member.username ?? member.accountId).slice(0, 2).toUpperCase() }}</span>
            <bdi class="latin-value">{{ member.displayName ?? member.username ?? member.accountId }}</bdi>
          </li>
        </ul>
      </section>
    </template>
  </section>
</template>

<style scoped>
.hero {
  padding: var(--space-6);
  margin-block-end: var(--space-6);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  background-color: var(--color-surface);
  background-image: var(--gradient-hero);
}

.hero-top {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.hero-title {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.hero-title h1 {
  margin: 0;
  font-size: var(--text-3xl);
}

.description {
  margin-block: var(--space-4) 0;
  color: var(--color-text-muted);
  max-inline-size: 70ch;
}

.avatar {
  display: grid;
  place-items: center;
  inline-size: 4rem;
  block-size: 4rem;
  flex: none;
  border-radius: var(--radius-lg);
  background: var(--gradient-brand);
  color: var(--color-primary-text);
  font-size: var(--text-lg);
  font-weight: var(--weight-bold);
}

.avatar-sm {
  inline-size: 2.25rem;
  block-size: 2.25rem;
  font-size: var(--text-sm);
}

.block {
  margin-block: var(--space-6);
}

.roster {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background-color: var(--color-surface);
  box-shadow: var(--shadow-sm);
}

.roster li {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-block-end: 1px solid var(--color-border);
  font-weight: var(--weight-semibold);
}

.roster li:last-child {
  border-block-end: none;
}
</style>
