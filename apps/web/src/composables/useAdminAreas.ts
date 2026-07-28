import { computed, type ComputedRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAdmin } from './useAdmin.ts';
import { isLocale } from '../i18n/locale.ts';

/**
 * Single definition of the administration areas, shared by the role-aware dashboard
 * (`/account`) and the administration landing (`/admin`) so the two can never drift.
 *
 * Only areas that have a real route are listed. Visibility mirrors the server's
 * effective permissions; hiding a card is never the authorization boundary, the server
 * enforces every route and API regardless of what the menu shows (section 9.4).
 */
export interface AdminArea {
  readonly to: string;
  readonly label: string;
  readonly testid: string;
}

export function useAdminAreas(): { areas: ComputedRef<AdminArea[]> } {
  const { t, locale } = useI18n();
  const {
    canReadUsers,
    canReadAudit,
    canReadConfig,
    canWriteContent,
    canPublishContent,
    canManageGames,
    canManageTournaments,
    canManageModeration,
    canManageSupport,
    canManageFinance,
    canManageOps
  } = useAdmin();

  const prefix = computed(() => `/${isLocale(locale.value) ? locale.value : 'fa'}`);

  const areas = computed<AdminArea[]>(() =>
    [
      { path: '/admin/content', labelKey: 'admin.area.content', visible: canWriteContent.value, testid: 'area-content' },
      { path: '/admin/games', labelKey: 'admin.area.games', visible: canManageGames.value, testid: 'area-games' },
      // The workspace leads for an organizer: it is the "what needs me" view over the
      // same events the full tournament list holds.
      { path: '/admin/organizer', labelKey: 'admin.area.organizer', visible: canManageTournaments.value, testid: 'area-organizer' },
      { path: '/admin/tournaments', labelKey: 'admin.area.tournaments', visible: canManageTournaments.value, testid: 'area-tournaments' },
      { path: '/admin/users', labelKey: 'admin.area.users', visible: canReadUsers.value, testid: 'area-users' },
      { path: '/admin/audit', labelKey: 'admin.area.audit', visible: canReadAudit.value, testid: 'area-audit' },
      { path: '/admin/moderation', labelKey: 'admin.area.moderation', visible: canManageModeration.value, testid: 'area-moderation' },
      { path: '/admin/media', labelKey: 'admin.area.media', visible: canPublishContent.value, testid: 'area-media' },
      // Restored now that the propose/approve workflow has a screen; this card previously
      // led to a not-found page, which is why it was removed (BUG-001).
      { path: '/admin/configuration', labelKey: 'admin.area.configuration', visible: canReadConfig.value, testid: 'area-configuration' },
      { path: '/admin/notifications', labelKey: 'admin.area.notifications', visible: canManageSupport.value, testid: 'area-notifications' },
      { path: '/admin/finance', labelKey: 'admin.area.finance', visible: canManageFinance.value, testid: 'area-finance' },
      { path: '/admin/support', labelKey: 'admin.area.support', visible: canManageSupport.value, testid: 'area-support' },
      { path: '/admin/operations', labelKey: 'admin.area.operations', visible: canManageOps.value, testid: 'area-operations' }
    ]
      .filter((area) => area.visible)
      .map((area) => ({ to: `${prefix.value}${area.path}`, label: t(area.labelKey), testid: area.testid }))
  );

  return { areas };
}
