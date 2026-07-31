import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { clearSupportSession, exchangeSupportCode } from '../lib/api.ts';

// Landing page for a partner "open read-only" link. The one-time code arrives in
// the URL FRAGMENT (#c=…), which browsers never send to a server and which we
// strip from history immediately after redeeming it.
export function SupportHandoff() {
  const { t } = useTranslation(['support', 'common']);
  const [error, setError] = useState<string | null>(null);
  // React 18 StrictMode mounts effects twice in dev; the code is single-use, so
  // the second run would always fail. Redeem at most once per mount.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const hash = window.location.hash.replace(/^#/, '');
    const code = new URLSearchParams(hash).get('c');
    // Drop the code from the address bar / history before anything else.
    window.history.replaceState(null, '', '/support');
    if (!code) {
      setError('SUPPORT_CODE_INVALID');
      return;
    }
    // A stale session in this tab must not shadow the new one.
    clearSupportSession();
    exchangeSupportCode(code)
      .then(() => {
        // Full reload, not a client-side navigate: the session store, i18n and
        // every cached fetch must start from scratch under the new identity.
        window.location.replace('/');
      })
      .catch((e: unknown) => {
        setError((e as { code?: string })?.code ?? 'SUPPORT_CODE_INVALID');
      });
  }, []);

  return (
    <SupportNotice
      title={error ? t('failed.title') : t('opening.title')}
      body={error ? t(`failed.${error === 'SUPPORT_CODE_INVALID' ? 'expired' : 'generic'}`) : t('opening.body')}
    />
  );
}

// Terminal screen: the session expired, was revoked from the console, or the
// partner ended it. No way back from here — the console mints a new link.
export function SupportEnded() {
  const { t } = useTranslation(['support', 'common']);
  useEffect(() => {
    clearSupportSession();
  }, []);
  return <SupportNotice title={t('ended.title')} body={t('ended.body')} />;
}

function SupportNotice({ title, body }: { title: string; body: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[color:var(--color-surface)] px-4 py-8">
      <div className="w-full max-w-md">
        <div className="card space-y-4 text-center">
          <img src="/icon-192.png" alt="" aria-hidden="true" className="mx-auto h-14 w-14" />
          <h1 className="text-xl font-bold">{title}</h1>
          <p className="muted text-sm">{body}</p>
        </div>
      </div>
    </main>
  );
}
