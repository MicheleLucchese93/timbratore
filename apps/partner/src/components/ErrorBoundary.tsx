import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { error: Error | null }

// Top-level boundary. Logs with a stable prefix so a blank-page report can be
// traced from the console (mirrors the webapp convention).
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', fontFamily: 'Inter, system-ui, sans-serif' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Si è verificato un errore</h1>
          <p style={{ color: 'var(--color-on-surface-variant)' }}>{this.state.error.message}</p>
          <button className="btn btn-secondary" style={{ marginTop: '1rem' }} onClick={() => window.location.assign('/')}>
            Torna alla home
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
