import type { ReactNode } from 'react';
import { Tooltip } from '@mui/material';

// Icon-only action button with a hover tooltip carrying the label (also the
// accessible name). Reuses the .icon-btn styling. Used for all row/inline/header
// actions across the console; primary form submits + cancel stay as text buttons.
export function IconButton({
  label,
  icon,
  onClick,
  testId,
  danger,
  primary,
  disabled,
  type = 'button',
}: {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  testId?: string;
  danger?: boolean;
  primary?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  const cls = `icon-btn${primary ? ' icon-btn-primary' : ''}${danger ? ' icon-btn-danger' : ''}`;
  return (
    <Tooltip title={label} arrow disableInteractive>
      <button
        type={type}
        className={cls}
        aria-label={label}
        data-testid={testId}
        disabled={disabled}
        onClick={onClick}
      >
        {icon}
      </button>
    </Tooltip>
  );
}
