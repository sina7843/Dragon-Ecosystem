<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppField from '../components/AppField.vue';
import StateBlock from '../components/StateBlock.vue';
import { ApiRequestError, apiFetch } from '../api.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { useAuth } from '../composables/useAuth.ts';
import { useToasts } from '../composables/useToasts.ts';

/**
 * Profile completion and editing (PAGE-012, FORM-003).
 * Age is enforced by the server; the client mirrors the rules for usability.
 */
interface Profile {
  username: string;
  displayName: string;
  birthDate: string;
  bio: string;
  visibility: 'private' | 'public';
}

const { t } = useI18n();
const { messageFor, fieldMessage } = useApiErrors();
const { refresh } = useAuth();
const { push } = useToasts();

const loading = ref(true);
const submitting = ref(false);
const formError = ref<string | undefined>(undefined);
const errors = ref<Record<string, string | undefined>>({});

const form = ref<Profile>({
  username: '',
  displayName: '',
  birthDate: '',
  bio: '',
  // Privacy by default: a profile is private until the user publishes it.
  visibility: 'private'
});

onMounted(async () => {
  try {
    form.value = await apiFetch<Profile>('/account/profile');
  } catch (error) {
    // 404 simply means the profile has not been created yet.
    if (!(error instanceof ApiRequestError) || error.status !== 404) {
      formError.value = messageFor(error);
    }
  } finally {
    loading.value = false;
  }
});

async function onSubmit(): Promise<void> {
  if (submitting.value) return;
  formError.value = undefined;
  errors.value = {};
  submitting.value = true;

  try {
    form.value = await apiFetch<Profile>('/account/profile', {
      method: 'PUT',
      body: JSON.stringify(form.value)
    });
    await refresh();
    push('success', t('profile.saved'));
  } catch (error) {
    for (const field of ['username', 'displayName', 'birthDate', 'timeZone', 'locale']) {
      errors.value[field] = fieldMessage(error, field);
    }
    if (Object.values(errors.value).every((value) => value === undefined)) {
      formError.value = messageFor(error);
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <section>
    <div class="page-header">
      <div>
        <h1>{{ t('profile.heading') }}</h1>
        <p class="page-lead">
          {{ t('profile.intro') }}
        </p>
      </div>
    </div>

    <StateBlock
      v-if="loading"
      variant="loading"
    />

    <form
      v-else
      novalidate
      data-testid="profile-form"
      @submit.prevent="onSubmit"
    >
      <p
        v-if="formError"
        class="summary"
        role="alert"
        data-testid="profile-error"
      >
        {{ formError }}
      </p>

      <AppField
        id="profile-username"
        v-model="form.username"
        :label="t('profile.username.label')"
        :hint="t('profile.username.hint')"
        :error="errors.username"
        required
        latin
        :disabled="submitting"
      />

      <AppField
        id="profile-display-name"
        v-model="form.displayName"
        :label="t('profile.displayName.label')"
        :error="errors.displayName"
        required
        :disabled="submitting"
      />

      <AppField
        id="profile-birth-date"
        v-model="form.birthDate"
        :label="t('profile.birthDate.label')"
        :hint="t('profile.birthDate.hint')"
        :error="errors.birthDate"
        type="date"
        required
        latin
        :disabled="submitting"
      />

      <fieldset class="visibility">
        <legend>{{ t('profile.visibility.legend') }}</legend>
        <p class="note">
          {{ t('profile.visibility.note') }}
        </p>
        <label>
          <input
            v-model="form.visibility"
            type="radio"
            value="private"
            data-testid="visibility-private"
          >
          {{ t('profile.visibility.private') }}
        </label>
        <label>
          <input
            v-model="form.visibility"
            type="radio"
            value="public"
            data-testid="visibility-public"
          >
          {{ t('profile.visibility.public') }}
        </label>
      </fieldset>

      <button
        type="submit"
        class="btn btn-primary"
        data-testid="profile-submit"
        :disabled="submitting"
      >
        {{ submitting ? t('profile.saving') : t('profile.save') }}
      </button>
    </form>
  </section>
</template>

<style scoped>
form {
  max-inline-size: 32rem;
}

.summary {
  padding: var(--space-3);
  border: 1px solid var(--color-danger-text);
  border-radius: var(--radius-md);
  background-color: var(--color-danger-surface);
  color: var(--color-danger-text);
  font-weight: 600;
}

.visibility {
  margin-block-end: var(--space-4);
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.visibility label {
  display: block;
  padding-block: var(--space-1);
}

.note {
  margin-block: 0 var(--space-2);
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}
</style>
