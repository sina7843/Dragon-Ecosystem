<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import AppField from '../components/AppField.vue';
import StateBlock from '../components/StateBlock.vue';
import { apiFetch } from '../api.ts';
import { useApiErrors } from '../composables/useApiErrors.ts';
import { useAuth } from '../composables/useAuth.ts';
import { useToasts } from '../composables/useToasts.ts';
import { isLocale } from '../i18n/locale.ts';
import { isolate } from '../i18n/format.ts';

/**
 * Mobile OTP authentication (PAGE-011, FORM-001, FORM-002).
 *
 * Responses are deliberately identical for known and unknown numbers, so this
 * page never reveals whether an account exists (AUTH-012).
 */
const { t, locale } = useI18n();
const router = useRouter();
const { messageFor, fieldMessage } = useApiErrors();
const { refresh, profileComplete } = useAuth();
const { push } = useToasts();

const step = ref<'mobile' | 'code'>('mobile');
const mobile = ref('');
const code = ref('');
const submitting = ref(false);
const formError = ref<string | undefined>(undefined);
const mobileError = ref<string | undefined>(undefined);
const codeError = ref<string | undefined>(undefined);
const resendAfterSeconds = ref(0);

const activeLocale = computed(() => (isLocale(locale.value) ? locale.value : 'fa'));

function clearErrors(): void {
  formError.value = undefined;
  mobileError.value = undefined;
  codeError.value = undefined;
}

async function onRequestCode(): Promise<void> {
  if (submitting.value) return;
  clearErrors();
  submitting.value = true;
  try {
    const result = await apiFetch<{ resendAfterSeconds: number }>('/auth/otp/request', {
      method: 'POST',
      body: JSON.stringify({ mobile: mobile.value, locale: activeLocale.value })
    });
    resendAfterSeconds.value = result.resendAfterSeconds;
    step.value = 'code';
  } catch (error) {
    mobileError.value = fieldMessage(error, 'mobile');
    if (mobileError.value === undefined) formError.value = messageFor(error);
  } finally {
    submitting.value = false;
  }
}

async function onVerify(): Promise<void> {
  if (submitting.value) return;
  clearErrors();
  submitting.value = true;
  try {
    await apiFetch('/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ mobile: mobile.value, code: code.value })
    });
    await refresh();
    push('success', t('auth.signedIn'));
    // A new account has no profile yet, so completion comes first.
    await router.push(
      profileComplete.value ? `/${activeLocale.value}/account` : `/${activeLocale.value}/account/profile`
    );
  } catch (error) {
    codeError.value = fieldMessage(error, 'code');
    if (codeError.value === undefined) formError.value = messageFor(error);
  } finally {
    submitting.value = false;
  }
}

function onChangeNumber(): void {
  clearErrors();
  code.value = '';
  step.value = 'mobile';
}
</script>

<template>
  <section>
    <h1>{{ t('auth.heading') }}</h1>
    <p>{{ t('auth.intro') }}</p>

    <p
      v-if="formError"
      class="summary"
      role="alert"
      data-testid="auth-error"
    >
      {{ formError }}
    </p>

    <form
      v-if="step === 'mobile'"
      novalidate
      data-testid="mobile-form"
      @submit.prevent="onRequestCode"
    >
      <AppField
        id="auth-mobile"
        v-model="mobile"
        :label="t('auth.mobile.label')"
        :hint="t('auth.mobile.hint')"
        :error="mobileError"
        type="tel"
        autocomplete="tel"
        inputmode="tel"
        required
        latin
        :disabled="submitting"
      />
      <button
        type="submit"
        class="primary"
        data-testid="request-code"
        :disabled="submitting"
      >
        {{ submitting ? t('auth.sending') : t('auth.requestCode') }}
      </button>
    </form>

    <form
      v-else
      novalidate
      data-testid="code-form"
      @submit.prevent="onVerify"
    >
      <p data-testid="code-sent">
        {{ t('auth.codeSent') }}
      </p>

      <AppField
        id="auth-code"
        v-model="code"
        :label="t('auth.code.label')"
        :hint="t('auth.code.hint', { seconds: isolate(resendAfterSeconds) })"
        :error="codeError"
        type="text"
        autocomplete="one-time-code"
        inputmode="numeric"
        required
        latin
        :disabled="submitting"
      />

      <div class="actions">
        <button
          type="submit"
          class="primary"
          data-testid="verify-code"
          :disabled="submitting"
        >
          {{ submitting ? t('auth.verifying') : t('auth.verify') }}
        </button>
        <button
          type="button"
          data-testid="change-number"
          :disabled="submitting"
          @click="onChangeNumber"
        >
          {{ t('auth.changeNumber') }}
        </button>
      </div>
    </form>

    <StateBlock
      v-if="submitting"
      variant="loading"
    />
  </section>
</template>

<style scoped>
form {
  max-inline-size: 28rem;
}

.summary {
  padding: var(--space-3);
  border: 1px solid var(--color-danger-text);
  border-radius: var(--radius-md);
  background-color: var(--color-danger-surface);
  color: var(--color-danger-text);
  font-weight: 600;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

button {
  padding-inline: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background-color: var(--color-surface-raised);
  color: var(--color-text);
  cursor: pointer;
}

.primary {
  border-color: var(--color-accent);
  background-color: var(--color-accent);
  color: var(--color-accent-text);
}

button:disabled {
  background-color: var(--color-surface-sunken);
  border-color: var(--color-border);
  color: var(--color-text-muted);
  cursor: not-allowed;
}
</style>
