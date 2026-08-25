import { type FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  API_KEY_NAME_MAX,
  API_KEY_RATE_LIMIT_MAX,
  API_KEY_RATE_LIMIT_MIN,
  API_RESOURCES,
  API_SCOPES,
  type ApiKeyCreated,
  type ApiKeySummary,
  type ApiScope,
} from '@sonoqui/shared';
import { useEscapeKey } from '../hooks/useEscapeKey.ts';
import { api } from '../lib/api.ts';
import { useSession } from '../store/session.ts';

/**
 * Create or edit one API key.
 *
 * Two phases when creating, and the second one is the point: the token exists
 * exactly once, in the response to the POST. There is no endpoint that can hand
 * it back — the server keeps only a hash (migration 064) — so the dialog
 * refuses to be dismissed casually while it is on screen, and says plainly that
 * this is the only time it will be shown.
 */

interface Props {
  /** Editing an existing key; omit to create a new one. */
  existing?: ApiKeySummary;
  onClose: () => void;
  onSaved: (created: ApiKeyCreated | null) => void;
}

/**
 * The last instant of a calendar day in a given IANA zone, as an ISO string.
 *
 * Built by asking Intl what the naive instant renders as in that zone and
 * correcting by the difference — the standard trick, and the only one that
 * survives DST without a date library.
 */
function endOfDayInZone(day: string, timeZone: string): string {
  const naive = new Date(`${day}T23:59:59Z`);
  const asIfLocal = new Date(naive.toLocaleString('en-US', { timeZone }));
  const asIfUtc = new Date(naive.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(naive.getTime() + (asIfUtc.getTime() - asIfLocal.getTime())).toISOString();
}

export function ApiKeyModal({ existing, onClose, onSaved }: Props) {
  const { t } = useTranslation(['apiKeys', 'common']);
  // The company's zone, not the browser's: an expiry the admin sets is a
  // statement about the company's calendar.
  const timeZone = useSession((st) => st.me?.tenant.timezone) ?? 'Europe/Rome';
  const [name, setName] = useState(existing?.name ?? '');
  const [scopes, setScopes] = useState<ApiScope[]>(existing?.scopes ?? []);
  const [rateLimit, setRateLimit] = useState(existing?.rate_limit_per_min ?? 120);
  const [expiresAt, setExpiresAt] = useState(existing?.expires_at?.slice(0, 10) ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // While the token is on screen, Escape and the backdrop must not close the
  // dialog: dismissing it by accident loses the credential permanently.
  useEscapeKey(() => {
    if (!token) onClose();
  });

  // Two fixed slots per row, read then write, with an empty slot where a
  // resource has no write half. Rendering only the scopes that exist let
  // "Lettura" slide under the "Scrittura" column on the read-only rows, which
  // read as the opposite of what it said.
  const byResource = useMemo(
    () =>
      API_RESOURCES.map((r) => ({
        resource: r,
        read: `${r}:read` as ApiScope,
        write: API_SCOPES.includes(`${r}:write` as ApiScope) ? (`${r}:write` as ApiScope) : null,
      })),
    []
  );

  const canSubmit = name.trim().length > 0 && scopes.length > 0 && !busy;

  function toggle(scope: ApiScope, on: boolean): void {
    setScopes((prev) => {
      const next = new Set(prev);
      if (on) {
        next.add(scope);
        // Ticking write implies read on the server (apiScopeSatisfied), so tick
        // it here too — a checkbox list that quietly disagrees with what the key
        // can do is worse than one extra tick.
        const read = scope.replace(':write', ':read') as ApiScope;
        if (scope.endsWith(':write')) next.add(read);
      } else {
        next.delete(scope);
        if (scope.endsWith(':read')) next.delete(scope.replace(':read', ':write') as ApiScope);
      }
      return Array.from(next).sort() as ApiScope[];
    });
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      const body = {
        name: name.trim(),
        scopes,
        rate_limit_per_min: rateLimit,
        // A date input gives a day; the API wants an instant. End of that day
        // IN THE COMPANY'S ZONE, so "expires 31 March" means the key works all
        // of 31 March and stops at local midnight — `…T23:59:59Z` would have
        // kept it alive until 01:59 the next morning in Rome.
        expires_at: expiresAt ? endOfDayInZone(expiresAt, timeZone) : null,
      };
      if (existing) {
        await api(`/api/v1/api-keys/${existing.id}`, { method: 'PATCH', json: body });
        onSaved(null);
        return;
      }
      const r = await api<{ key: ApiKeyCreated }>('/api/v1/api-keys', {
        method: 'POST',
        json: body,
      });
      setToken(r.key.token);
      onSaved(r.key);
    } catch (e2) {
      const code = (e2 as { code?: string } | null)?.code;
      setErr(
        code === 'API_KEYS_LIMIT'
          ? t('err.limit')
          : code === 'SUPPORT_READ_ONLY'
            ? t('err.readOnly')
            : t('err.generic')
      );
    } finally {
      setBusy(false);
    }
  }

  async function copy(): Promise<void> {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard access can be refused (permissions, insecure context). The
      // token is selectable text either way, so this is not worth an error.
    }
  }

  if (token) {
    return (
      <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
        <div
          className="card w-full max-w-lg space-y-4"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="ak-created-title"
          aria-describedby="ak-created-warning"
          // Focus moves here so a keyboard or screen-reader user lands on the
          // one screen in the app whose content cannot be recovered.
          ref={(el) => el?.focus()}
          tabIndex={-1}
        >
          <h2 className="section-title" id="ak-created-title">
            {t('created.title')}
          </h2>
          <p className="text-sm" id="ak-created-warning">
            {t('created.warning')}
          </p>
          <code
            data-testid="api-key-token"
            className="block w-full break-all rounded-md border border-[color:var(--color-outline)] bg-[color:var(--color-surface-variant)] p-3 font-mono text-xs"
          >
            {token}
          </code>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => void copy()}>
              {copied ? t('created.copied') : t('created.copy')}
            </button>
            <button type="button" className="btn btn-primary" onClick={onClose}>
              {t('created.done')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50" onClick={onClose}>
      <form
        className="card w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => void submit(e)}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ak-form-title"
      >
        <h2 className="section-title" id="ak-form-title">
          {existing ? t('edit.title') : t('new.title')}
        </h2>

        <div>
          <label className="label" htmlFor="ak-name">
            {t('field.name')}
          </label>
          <input
            id="ak-name"
            className="input"
            maxLength={API_KEY_NAME_MAX}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('field.namePlaceholder')}
          />
          <p className="field-hint">{t('field.nameHint')}</p>
        </div>

        <fieldset className="border-0 p-0 m-0">
          <legend className="label p-0">{t('field.scopes')}</legend>
          <p className="field-hint">{t('field.scopesHint')}</p>
          <div className="mt-2 space-y-1.5">
            {byResource.map(({ resource, read, write }) => (
              <div
                key={resource}
                className="grid grid-cols-[1fr_5.5rem_5.5rem] items-center gap-2"
                role="group"
                aria-label={t(`resource.${resource}`)}
              >
                <span className="text-sm" id={`ak-res-${resource}`}>
                  {t(`resource.${resource}`)}
                </span>
                <label className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    data-testid={`scope-${read}`}
                    // Read out as "Timbrature, Lettura" rather than a bare
                    // "Lettura" repeated thirteen times down the dialog.
                    aria-label={`${t(`resource.${resource}`)} — ${t('access.read')}`}
                    checked={scopes.includes(read)}
                    onChange={(e) => toggle(read, e.target.checked)}
                  />
                  {t('access.read')}
                </label>
                {write ? (
                  <label className="flex items-center gap-1.5 text-xs">
                    <input
                      type="checkbox"
                      data-testid={`scope-${write}`}
                      aria-label={`${t(`resource.${resource}`)} — ${t('access.write')}`}
                      checked={scopes.includes(write)}
                      onChange={(e) => toggle(write, e.target.checked)}
                    />
                    {t('access.write')}
                  </label>
                ) : (
                  // Deliberately a rendered blank rather than nothing: it keeps
                  // the column, and the absence of a box IS the statement that
                  // this resource cannot be written through the API.
                  <span className="text-xs text-[color:var(--color-on-surface-variant)]">
                    {t('access.readOnly')}
                  </span>
                )}
              </div>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="ak-rate">
              {t('field.rateLimit')}
            </label>
            <input
              id="ak-rate"
              className="input num"
              type="number"
              min={API_KEY_RATE_LIMIT_MIN}
              max={API_KEY_RATE_LIMIT_MAX}
              value={rateLimit}
              onChange={(e) => setRateLimit(Number(e.target.value))}
            />
            <p className="field-hint">{t('field.rateLimitHint')}</p>
          </div>
          <div>
            <label className="label" htmlFor="ak-expires">
              {t('field.expiresAt')}
            </label>
            <input
              id="ak-expires"
              className="input"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
            <p className="field-hint">{t('field.expiresAtHint')}</p>
          </div>
        </div>

        {err && (
          <p className="field-hint" style={{ color: 'var(--color-error)' }}>
            {err}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose}>
            {t('common:btn.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {existing ? t('edit.save') : t('new.create')}
          </button>
        </div>
      </form>
    </div>
  );
}
