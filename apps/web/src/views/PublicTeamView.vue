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
      <h1>{{ team.name }}</h1>
      <p v-if="team.description">
        {{ team.description }}
      </p>
      <h2>{{ t('teams.public.roster') }}</h2>
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
          {{ member.displayName ?? member.username }}
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.roster {
  list-style: none;
  margin: 0;
  padding: 0;
}

.roster li {
  padding-block: var(--space-2);
  border-block-end: 1px solid var(--color-border);
}
</style>
