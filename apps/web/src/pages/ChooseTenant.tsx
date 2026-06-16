import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../store/session.ts';

// Shown after login when the account belongs to more than one company. Picking
// one stores the choice and reloads the session for that company (role, nav and
// data all follow). Single-company users never see this screen.
export function ChooseTenant() {
  const { t } = useTranslation(['chooseTenant', 'common']);
  const tenants = useSession((s) => s.tenants);
  const chooseTenant = useSession((s) => s.chooseTenant);
  const logout = useSession((s) => s.logout);
  const [busy, setBusy] = useState<string | null>(null);

  async function pick(id: string) {
    if (busy) return;
    setBusy(id);
    try {
      await chooseTenant(id);
    } catch {
      setBusy(null);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[color:var(--color-surface)] px-4 py-8">
      <div className="w-full max-w-md">
        <div className="card space-y-5">
          <div className="text-center flex flex-col items-center">
            <img src="/icon-192.png" alt="" aria-hidden="true" className="mb-3 h-14 w-14" />
            <h1 className="text-xl font-bold">{t('title')}</h1>
            <p className="muted mt-1 text-sm">
              {t('subtitle')}
            </p>
          </div>

          <ul className="space-y-2">
            {tenants.map((tn) => (
              <li key={tn.tenant_id}>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => void pick(tn.tenant_id)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition-colors hover:bg-[color:var(--color-surface-variant)] disabled:opacity-60"
                  style={{ borderColor: 'var(--color-outline)' }}
                >
                  <span className="font-medium">{tn.ragione_sociale}</span>
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold"
                    style={{ background: 'var(--color-surface-variant)', color: 'var(--color-on-surface)' }}
                  >
                    {busy === tn.tenant_id
                      ? t('entering')
                      : tn.role === 'admin'
                        ? t('common:role.admin')
                        : t('common:role.user')}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => void logout()}
            className="muted w-full text-center text-sm hover:underline"
          >
            {t('common:btn.logout')}
          </button>
        </div>
      </div>
    </main>
  );
}
