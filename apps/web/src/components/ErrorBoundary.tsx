import { Component, type ErrorInfo, type ReactNode } from 'react';
import i18n from '../i18n/index.ts';

// A render-phase crash anywhere below this boundary would otherwise blank the
// entire SPA (the dreaded white page) — there is no other boundary in the tree,
// so React unmounts to the root. This converts that into a readable card and
// logs the real cause to the console.
//
// Special case: after a deploy the server ships new chunk hashes, so an
// already-open tab's lazy import() 404s ("failed to fetch dynamically imported
// module"). That is not a bug in the page — the fix is a reload — so we detect
// it and lead with a reload prompt instead of an error.

function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return /loading chunk|dynamically imported module|failed to fetch dynamically|importing a module script failed|module script failed/i.test(
    msg
  );
}

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
  chunk: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, chunk: false };

  static getDerivedStateFromError(error: Error): State {
    return { error, chunk: isChunkLoadError(error) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The single most useful artefact when a user reports a white page: the
    // real error + component stack, in their console.
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private reset = (): void => this.setState({ error: null, chunk: false });

  override render(): ReactNode {
    const { error, chunk } = this.state;
    if (!error) return this.props.children;

    const t = i18n.t.bind(i18n);
    return (
      <div className="grid min-h-[60vh] place-items-center p-6">
        <div className="card max-w-md space-y-3 text-center">
          <h2 className="section-title">
            {t(chunk ? 'common:errorBoundary.staleTitle' : 'common:errorBoundary.title')}
          </h2>
          <p className="text-sm muted">
            {t(chunk ? 'common:errorBoundary.staleBody' : 'common:errorBoundary.body')}
          </p>
          {!chunk && (
            <details className="text-left text-xs muted">
              <summary className="cursor-pointer">{t('common:errorBoundary.details')}</summary>
              <pre className="mt-2 overflow-auto whitespace-pre-wrap" style={{ maxHeight: 180 }}>
                {error.message}
              </pre>
            </details>
          )}
          <div className="flex justify-center gap-2">
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              {t('common:errorBoundary.reload')}
            </button>
            {!chunk && (
              <button type="button" className="btn btn-secondary" onClick={this.reset}>
                {t('common:btn.retry')}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
}
