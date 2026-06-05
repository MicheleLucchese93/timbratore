import { useState } from 'react';
import { useSession } from '../store/session.ts';

// Shown after login when the account belongs to more than one company. Picking
// one stores the choice and reloads the session for that company (role, nav and
// data all follow). Single-company users never see this screen.
export function ChooseTenant() {
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
            <h1 className="text-xl font-bold">Scegli l'azienda</h1>
            <p className="mt-1 text-sm text-neutral-600">
              Il tuo account è collegato a più aziende. Seleziona quella su cui vuoi lavorare.
            </p>
          </div>

          <ul className="space-y-2">
            {tenants.map((t) => (
              <li key={t.tenant_id}>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => void pick(t.tenant_id)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition-colors hover:bg-[color:var(--color-surface-variant)] disabled:opacity-60"
                  style={{ borderColor: 'var(--color-outline, #d4d4d8)' }}
                >
                  <span className="font-medium">{t.ragione_sociale}</span>
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold"
                    style={{ background: 'var(--color-surface-variant, #f1f1f4)', color: 'var(--color-on-surface, #3a3a3a)' }}
                  >
                    {busy === t.tenant_id
                      ? 'Accesso…'
                      : t.role === 'admin'
                        ? 'Amministratore'
                        : 'Dipendente'}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => void logout()}
            className="w-full text-center text-sm text-neutral-600 hover:underline"
          >
            Esci
          </button>
        </div>
      </div>
    </main>
  );
}
