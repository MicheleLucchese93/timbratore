import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import {
  API_KEYS_PER_TENANT_MAX,
  apiKeyIsActive,
  type ApiKeyCreated,
  type ApiKeySummary,
} from '@sonoqui/shared';
import { api, apiUrl, isSupportMode } from '../lib/api.ts';
import { useConfirm } from './ConfirmDialog.tsx';
import { ApiKeyModal } from './ApiKeyModal.tsx';
import { EmptyState } from './EmptyState.tsx';

/**
 * Impostazioni → API: the company's machine credentials.
 *
 * Rendered only when the API module is on (the partner switches it) AND the
 * caller is an admin — the same two conditions the backend gate enforces, so a
 * user who somehow reaches the page sees nothing rather than a section whose
 * every call 403s.
 *
 * Buttons and a dialog rather than inline switches, deliberately: a credential
 * is not a preference, it wants a confirmation step and a name.
 */
const OPENAPI_PATH = '/api/public/v1/openapi.json';
/** What lands in the admin's Downloads folder, and what they forward on. */
const OPENAPI_FILENAME = 'sonoqui-openapi.json';

export function ApiKeysSection({ onToast }: { onToast: (text: string) => void }) {
  const { t, i18n } = useTranslation(['apiKeys', 'common']);
  const confirm = useConfirm();
  const [keys, setKeys] = useState<ApiKeySummary[] | null>(null);
  const [modal, setModal] = useState<{ existing?: ApiKeySummary } | null>(null);
  const [err, setErr] = useState(false);
  const [docsBusy, setDocsBusy] = useState(false);
  // A read-only support session cannot mint or revoke anything (the server
  // refuses every non-GET). Saying so up front beats a confusing failure.
  const readOnly = isSupportMode();

  const load = useCallback(async () => {
    try {
      const r = await api<{ keys: ApiKeySummary[] }>('/api/v1/api-keys');
      setKeys(r.keys);
      setErr(false);
    } catch {
      setKeys([]);
      setErr(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Hand the OpenAPI document over as a FILE.
   *
   * The plain link opened it in a tab, which is the wrong outcome: this is a
   * thing an admin forwards to whoever builds the integration, not something
   * they read. `download` alone is not enough — the attribute is ignored on a
   * cross-origin href, and in the xdevapp build the API lives on another host —
   * so the bytes are fetched and saved from a blob.
   *
   * The `href` stays real on purpose. A developer wants the URL (Postman and
   * Swagger Editor both import by link), so right-click-copy and
   * cmd/middle-click still do the browser's thing; only a plain left click is
   * intercepted. And the endpoint keeps serving inline JSON rather than
   * Content-Disposition: attachment, so pasting that URL anywhere still works.
   */
  async function downloadDocs(e: MouseEvent<HTMLAnchorElement>): Promise<void> {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    setDocsBusy(true);
    try {
      const r = await fetch(apiUrl(OPENAPI_PATH), { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(String(r.status));
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = OPENAPI_FILENAME;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Not revoked synchronously: Safari has not finished reading the blob when
      // click() returns, and revoking there cancels the download.
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      // CORS refusal, offline, a 500 — fall back to what the link did before
      // rather than leaving the click doing nothing at all.
      window.open(apiUrl(OPENAPI_PATH), '_blank', 'noreferrer');
    } finally {
      setDocsBusy(false);
    }
  }

  async function revoke(k: ApiKeySummary): Promise<void> {
    const okToGo = await confirm({
      title: t('revoke.title', { name: k.name }),
      message: t('revoke.message'),
      confirmLabel: t('revoke.confirm'),
      danger: true,
    });
    if (!okToGo) return;
    try {
      await api(`/api/v1/api-keys/${k.id}/revoke`, { method: 'POST' });
      onToast(t('revoke.done'));
      await load();
    } catch {
      onToast(t('err.generic'));
    }
  }

  const live = (keys ?? []).filter((k) => apiKeyIsActive(k)).length;

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <p className="field-hint m-0">{t('intro')}</p>
        {!readOnly && (
          <button
            type="button"
            className="btn btn-primary shrink-0"
            data-testid="api-key-new"
            disabled={live >= API_KEYS_PER_TENANT_MAX}
            onClick={() => setModal({})}
          >
            {t('new.title')}
          </button>
        )}
      </div>

      {keys === null ? (
        <div className="mt-4 h-20 animate-pulse rounded bg-[color:var(--color-surface-variant)]" />
      ) : err ? (
        <p className="field-hint mt-3" style={{ color: 'var(--color-error)' }}>
          {t('err.load')}
        </p>
      ) : keys.length === 0 ? (
        <div className="mt-2">
          {/* `icon` + `sm`, not an illustrated scene: this sits inside a
              settings panel, where a full-page scene would be a billboard in a
              drawer (see EmptyState's own note on the two modes). */}
          <EmptyState icon={<IconPlug />} title={t('empty.title')} hint={t('empty.hint')} size="sm" />
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm" data-testid="api-keys-table">
            <thead>
              <tr className="text-left text-xs uppercase text-[color:var(--color-on-surface-variant)]">
                <th className="py-1.5 pr-3">{t('col.name')}</th>
                <th className="py-1.5 pr-3">{t('col.key')}</th>
                <th className="py-1.5 pr-3">{t('col.scopes')}</th>
                <th className="py-1.5 pr-3">{t('col.lastUsed')}</th>
                <th className="py-1.5 pr-3">{t('col.state')}</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => {
                const active = apiKeyIsActive(k);
                return (
                  <tr key={k.id} className="border-t border-[color:var(--color-outline-variant)]">
                    <td className="py-2 pr-3">
                      <span className="font-medium">{k.name}</span>
                      {k.created_by_label && (
                        <span className="block text-xs text-[color:var(--color-on-surface-variant)]">
                          {t('col.createdBy', { who: k.created_by_label })}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs whitespace-nowrap">
                      sq_live_{k.key_id}…{k.last_four}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="text-xs">{k.scopes.length}</span>
                      <span className="block text-xs text-[color:var(--color-on-surface-variant)]">
                        {k.scopes.slice(0, 3).join(', ')}
                        {k.scopes.length > 3 ? '…' : ''}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-xs whitespace-nowrap">
                      {/* The app's language, not the browser's: an Italian admin
                          on an English-locale laptop should not read this row in
                          a different format from every other date on the page. */}
                      {k.last_used_at
                        ? new Date(k.last_used_at).toLocaleString(i18n.language)
                        : t('col.neverUsed')}
                    </td>
                    <td className="py-2 pr-3 text-xs">
                      {k.revoked_at
                        ? t('state.revoked')
                        : active
                          ? t('state.active')
                          : t('state.expired')}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {!readOnly && active && (
                        <>
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => setModal({ existing: k })}
                          >
                            {t('common:btn.edit')}
                          </button>{' '}
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            data-testid={`api-key-revoke-${k.id}`}
                            onClick={() => void revoke(k)}
                          >
                            {t('revoke.action')}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {live >= API_KEYS_PER_TENANT_MAX && (
            <p className="field-hint mt-2">{t('atLimit', { max: API_KEYS_PER_TENANT_MAX })}</p>
          )}
        </div>
      )}

      {/* The contract, for whoever builds the integration. Unauthenticated and
          tenant-free, so it is safe to hand to a supplier before any key
          exists — which is exactly when they need it. */}
      <p className="field-hint mt-3">
        <a
          className="font-medium text-[color:var(--color-primary)] hover:underline"
          href={apiUrl(OPENAPI_PATH)}
          download={OPENAPI_FILENAME}
          onClick={(e) => void downloadDocs(e)}
        >
          {docsBusy ? t('docs.downloading') : t('docs.label')}
        </a>{' '}
        — {t('docs.hint')}
      </p>

      {/* PORTALLED, and it has to be. This section is rendered inside the
          Settings page's own <form>, and an HTML form cannot contain another
          one: the browser drops the inner <form> tag, so the dialog's submit
          button ends up submitting the SETTINGS form and navigating the page
          away instead of creating a key. ChangePasswordModal solves the same
          problem by living outside the form; a portal lets this section stay
          self-contained. */}
      {modal && createPortal(
        <ApiKeyModal
          {...(modal.existing ? { existing: modal.existing } : {})}
          onClose={() => {
            setModal(null);
            void load();
          }}
          onSaved={(created: ApiKeyCreated | null) => {
            // On create the dialog stays open to show the token once; only the
            // edit path can report success immediately.
            if (!created) {
              setModal(null);
              onToast(t('edit.done'));
              void load();
            }
          }}
        />,
        document.body
      )}
    </>
  );
}

/** Plug glyph — a connector, not a cog: the module is about something else
 *  plugging into sonoQui. Matches IconPlug in the partner console. */
function IconPlug() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 3v6" />
      <path d="M15 3v6" />
      <path d="M7 9h10v3a5 5 0 0 1-5 5 5 5 0 0 1-5-5V9z" />
      <path d="M12 17v4" />
    </svg>
  );
}
