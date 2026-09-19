import { useTranslation } from 'react-i18next';
import {
  fmtDate,
  subStatusTone,
  vatTone,
  type PlanKey,
  type SignupSource,
  type VatStatus,
} from '../lib/billing.ts';

// Small read-only chips for the self-service billing data. Kept in one place so
// Aziende, Registrazioni and the Abbonamento dialog say the same thing the same way.

/** Partner-provisioned vs registered from the website. */
export function OriginBadge({ source }: { source: SignupSource | null | undefined }) {
  const { t } = useTranslation();
  const self = source === 'self_service';
  return (
    <span
      className={`badge ${self ? 'badge-info' : 'badge-muted'}`}
      title={t(self ? 'billing.origin.self_serviceTitle' : 'billing.origin.partnerTitle')}
    >
      {t(self ? 'billing.origin.self_service' : 'billing.origin.partner')}
    </span>
  );
}

/** "Gratuito", plus the paid plan chosen but not yet paid and the over-limit flag. */
export function PlanBadge({
  plan,
  pendingPlan,
  overLimitSince,
}: {
  plan: PlanKey | null | undefined;
  pendingPlan?: 'piccola' | 'media' | null;
  overLimitSince?: string | null;
}) {
  const { t, i18n } = useTranslation();
  if (!plan) return <span className="muted">—</span>;
  return (
    <span className="badge-line">
      <span className={plan === 'free' ? 'badge badge-muted' : 'badge badge-info'}>{t(`billing.plan.${plan}`)}</span>
      {pendingPlan && (
        <span className="muted small" title={t('billing.pendingPlanTitle', { plan: t(`billing.plan.${pendingPlan}`) })}>
          {t('billing.pendingPlan', { plan: t(`billing.plan.${pendingPlan}`) })}
        </span>
      )}
      {overLimitSince && (
        <span
          className="badge badge-warn"
          title={t('billing.overLimitSince', { date: fmtDate(overLimitSince, i18n.language) })}
        >
          {t('billing.overLimit')}
        </span>
      )}
    </span>
  );
}

/** Latest plan subscription: Attivo / Pagamento in sospeso / Terminato / —. */
export function SubStatusBadge({ status }: { status: string | null | undefined }) {
  const { t } = useTranslation();
  if (!status) return <span className="muted">—</span>;
  return (
    <span className={`badge ${subStatusTone(status)}`}>
      {t(`billing.subStatus.${status}`, { defaultValue: status })}
    </span>
  );
}

/** VIES outcome of a P.IVA (+ "rivista" once a human has checked it). */
export function VatBadge({
  status,
  reviewedAt,
  requestId,
}: {
  status: VatStatus | null | undefined;
  reviewedAt?: string | null;
  requestId?: string | null;
}) {
  const { t, i18n } = useTranslation();
  if (!status) return null;
  const title = [t('billing.vat.title'), requestId ? t('billing.vat.requestId', { id: requestId }) : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <>
      <span className={`badge ${vatTone(status)}`} title={title} data-testid="vat-badge">
        {t(`billing.vat.${status}`, { defaultValue: status })}
      </span>
      {reviewedAt && (
        <span
          className="badge badge-muted"
          title={t('billing.vat.reviewedTitle', { date: fmtDate(reviewedAt, i18n.language) })}
        >
          {t('billing.vat.reviewed')}
        </span>
      )}
    </>
  );
}

/** P.IVA followed by its VIES badges, on one line. */
export function PivaCell({
  piva,
  status,
  reviewedAt,
  requestId,
}: {
  piva: string | null | undefined;
  status: VatStatus | null | undefined;
  reviewedAt?: string | null;
  requestId?: string | null;
}) {
  if (!piva) return <span className="muted">—</span>;
  return (
    <span className="badge-line">
      <span className="mono">{piva}</span>
      <VatBadge status={status} reviewedAt={reviewedAt} requestId={requestId} />
    </span>
  );
}
