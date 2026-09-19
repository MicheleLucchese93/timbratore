import type { ReactNode } from 'react';
import { Tooltip } from '@mui/material';

// Icon-only action button with a hover tooltip carrying the label (also the
// accessible name). Reuses the .icon-btn styling. Used for all row/inline/header
// actions across the console; primary form submits + cancel stay as text buttons.
//
// `hint` replaces the tooltip text (the accessible name stays `label`) — used to
// say WHY an action is disabled. A disabled <button> fires no mouse events, so
// the tooltip then listens on a wrapping span instead.
export function IconButton({
  label,
  icon,
  onClick,
  testId,
  danger,
  primary,
  disabled,
  hint,
  type = 'button',
}: {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  testId?: string;
  danger?: boolean;
  primary?: boolean;
  disabled?: boolean;
  hint?: string;
  type?: 'button' | 'submit';
}) {
  const cls = `icon-btn${primary ? ' icon-btn-primary' : ''}${danger ? ' icon-btn-danger' : ''}`;
  const button = (
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
  );
  return (
    <Tooltip title={hint ?? label} arrow disableInteractive>
      {disabled ? <span style={{ display: 'inline-flex' }}>{button}</span> : button}
    </Tooltip>
  );
}
