import type { TFunction } from 'i18next';
import type { ApiError } from './api.ts';

/**
 * Localized text for a 409 LIMIT_REACHED ({kind, current, limit}) — the one
 * error every create path returns at a plan cap. A self-service company gets
 * the upsell ("Passa a Premium"), a partner-managed one is pointed at its
 * partner. Null when the error is something else.
 */
export function limitMessage(
  e: unknown,
  t: TFunction,
  billingMode: 'managed' | 'stripe' | undefined
): string | null {
  const err = e as ApiError | null;
  if (err?.code !== 'LIMIT_REACHED') return null;
  const d = (err.details ?? {}) as { kind?: string; limit?: number; max?: number };
  const limit = d.limit ?? d.max ?? '';
  const known = ['users', 'admins', 'branches', 'documentali'].includes(d.kind ?? '');
  const base = known
    ? t(`billing:limit.${d.kind}`, { limit })
    : t('billing:limit.generic');
  return `${base} ${billingMode === 'stripe' ? t('billing:limit.upsell') : t('billing:limit.contact')}`;
}
