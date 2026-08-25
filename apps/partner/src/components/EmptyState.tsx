import type { ReactNode } from 'react';
import { EmptyArt, type EmptyArtName } from './EmptyArt.tsx';

export interface EmptyStateProps {
  title: ReactNode;
  /** One sentence under the title. Say what will fill the screen, not that it is empty. */
  hint?: ReactNode;
  /**
   * Animated scene above the text. Prevails over `icon`: where there is a
   * scene, the glyph adds nothing. See EmptyArt.tsx for the catalogue.
   */
  art?: EmptyArtName;
  /** Draw the scene in its resting pose — for screens that show several at once. */
  still?: boolean;
  /**
   * Decorative glyph. The short way, kept for the secondary empty states inside
   * a panel or a table body, where a full illustration would be a billboard in
   * a drawer. No chip behind it.
   */
  icon?: ReactNode;
  /** Primary call to action, e.g. "Nuova azienda". */
  action?: ReactNode;
  /**
   * `lg` fills a page; `md` sits inside a column, a card or a table body next
   * to other content; `sm` is a single line of type for a sub-panel.
   */
  size?: 'lg' | 'md' | 'sm';
  /**
   * Centre the block in the page instead of letting it sit at the top.
   *
   * A reserved min-height plus centring inside it, and auto margins on top:
   * `.main-body` is already a flex column, so the margins bite and the block
   * lands in the middle of the real page height. When the block is taller than
   * the reserve it simply grows and nothing is cut off.
   */
  fill?: boolean;
  className?: string;
  'data-testid'?: string;
}

/**
 * "Nothing here yet". Never render a bare empty list or table body.
 *
 * No surface of its own: a frame adds no information to "empty", and on a page
 * whose only content IS the empty state it reads as a small card marooned at
 * the top of a large screen. `fill` centres what is left and the illustration
 * carries the weight — the same block the main web app uses, kept here the way
 * this console keeps its own `.btn` and `PageHeader`.
 */
export function EmptyState({
  title,
  hint,
  art,
  still,
  icon,
  action,
  size = 'lg',
  fill = false,
  className,
  'data-testid': testId,
}: EmptyStateProps) {
  const cls = [
    'empty-state',
    'empty-art-scope',
    size === 'md' ? 'empty-state-md' : '',
    size === 'sm' ? 'empty-state-sm' : '',
    fill ? 'empty-state-fill' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls} data-testid={testId}>
      {art != null ? (
        <EmptyArt name={art} still={still} className="empty-state-enter-art" />
      ) : (
        icon != null && (
          <span className="empty-state-icon empty-state-enter" aria-hidden="true">
            {icon}
          </span>
        )
      )}
      <p className="empty-state-title empty-state-enter-body">{title}</p>
      {hint != null && hint !== '' && <p className="empty-state-hint empty-state-enter-body">{hint}</p>}
      {action != null && <div className="empty-state-action empty-state-enter-action">{action}</div>}
    </div>
  );
}
