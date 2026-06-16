import { useTranslation } from 'react-i18next';

export type IconButtonKind =
  | 'edit'
  | 'duplicate'
  | 'deactivate'
  | 'reactivate'
  | 'delete'
  | 'approve'
  | 'reject'
  | 'revoke'
  | 'adjust'
  | 'history'
  | 'reset-password'
  | 'download'
  | 'cancel';

const TONE: Record<IconButtonKind, '' | 'danger' | 'success' | 'primary'> = {
  edit: '',
  duplicate: '',
  deactivate: '',
  reactivate: '',
  delete: 'danger',
  approve: 'success',
  reject: 'danger',
  revoke: 'danger',
  adjust: '',
  history: '',
  'reset-password': '',
  download: 'primary',
  cancel: '',
};

// Default i18n key per kind, used when no explicit `title` prop is given.
// Generic actions reuse the shared `common:btn.*` keys; the rest live in the
// `components` namespace under `iconButton.*`.
const DEFAULT_TITLE_KEY: Record<IconButtonKind, string> = {
  edit: 'common:btn.edit',
  duplicate: 'components:iconButton.duplicate',
  deactivate: 'components:iconButton.deactivate',
  reactivate: 'components:iconButton.reactivate',
  delete: 'common:btn.delete',
  approve: 'common:btn.approve',
  reject: 'common:btn.reject',
  revoke: 'components:iconButton.revoke',
  adjust: 'components:iconButton.adjust',
  history: 'components:iconButton.history',
  'reset-password': 'components:iconButton.resetPassword',
  download: 'common:btn.download',
  cancel: 'common:btn.cancel',
};

interface IconButtonProps {
  kind: IconButtonKind;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}

export function IconButton({ kind, onClick, disabled, title }: IconButtonProps) {
  const { t } = useTranslation(['components', 'common']);
  const tone = TONE[kind];
  const cls = ['icon-btn', tone ? `icon-btn-${tone}` : ''].filter(Boolean).join(' ');
  const label = title ?? t(DEFAULT_TITLE_KEY[kind]);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cls}
    >
      {renderIcon(kind)}
    </button>
  );
}

function renderIcon(kind: IconButtonKind) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (kind) {
    case 'edit':
      return (
        <svg {...common}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
        </svg>
      );
    case 'duplicate':
      // Two overlapping sheets — copy/duplicate.
      return (
        <svg {...common}>
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      );
    case 'deactivate':
      return (
        <svg {...common}>
          <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
          <line x1="12" y1="2" x2="12" y2="12" />
        </svg>
      );
    case 'reactivate':
      return (
        <svg {...common}>
          <polygon points="6 4 20 12 6 20 6 4" />
        </svg>
      );
    case 'delete':
      return (
        <svg {...common}>
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
          <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
        </svg>
      );
    case 'approve':
      return (
        <svg {...common}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
    case 'reject':
      return (
        <svg {...common}>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      );
    case 'revoke':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M5.6 5.6l12.8 12.8" />
        </svg>
      );
    case 'adjust':
      // Plus/minus — manual add/remove of hours.
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <line x1="8" y1="9.5" x2="16" y2="9.5" />
          <line x1="12" y1="5.5" x2="12" y2="13.5" />
          <line x1="8" y1="17" x2="16" y2="17" />
        </svg>
      );
    case 'history':
      // Clock with a counter-clockwise arrow — audit timeline.
      return (
        <svg {...common}>
          <path d="M3 3v5h5" />
          <path d="M3.05 13a9 9 0 1 0 2.6-6.36L3 8" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case 'reset-password':
      // Key — resend password-reset email.
      return (
        <svg {...common}>
          <circle cx="7.5" cy="15.5" r="5.5" />
          <path d="m21 2-9.6 9.6" />
          <path d="m15.5 7.5 3 3" />
        </svg>
      );
    case 'download':
      // Tray with a down arrow — download the generated file.
      return (
        <svg {...common}>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
      );
    case 'cancel':
      // X inside a circle — cancel/withdraw a row (distinct from the trash delete).
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <line x1="15" y1="9" x2="9" y2="15" />
          <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      );
  }
}
