import type { ComponentProps, ReactNode } from 'react';
import { GridOverlay, useGridApiContext } from '@mui/x-data-grid';
import { EmptyState } from './EmptyState.tsx';
import type { EmptyArtName } from './EmptyArt.tsx';

/**
 * Extra props this app's no-rows overlay accepts through `slotProps`.
 *
 * MUI's own augmentation point: without it `slotProps.noRowsOverlay` is typed
 * as the bare `GridOverlayProps` and every call site would need a cast.
 */
declare module '@mui/x-data-grid' {
  interface NoRowsOverlayPropsOverrides {
    art?: EmptyArtName;
    title?: ReactNode;
    hint?: ReactNode;
    action?: ReactNode;
  }
}

/**
 * The empty body of a DataGrid.
 *
 * Wired into `dataGridDefaults`, so every grid in the app gets the illustrated
 * block instead of the framework's one grey line — a table that has just been
 * filtered down to nothing looks identical to one that failed to load when the
 * only difference is six words of Helvetica.
 *
 * The title falls back to the grid's own `noRowsLabel`, which is what the
 * localeText of a page that has already been translated provides; pass `art`,
 * `title`, `hint` or `action` through `slotProps.noRowsOverlay` to say
 * something more specific than "no rows".
 */
export function GridEmptyOverlay({
  art = 'search',
  title,
  hint,
  action,
  ...overlayProps
}: {
  art?: EmptyArtName;
  title?: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
} & ComponentProps<typeof GridOverlay>) {
  const apiRef = useGridApiContext();
  return (
    <GridOverlay
      {...overlayProps}
      // The framework paints a backdrop tint behind the overlay: over an empty
      // body that reads as the very panel this redesign removed.
      sx={{ background: 'transparent', ...overlayProps.sx }}
    >
      <EmptyState
        size="md"
        art={art}
        title={title ?? apiRef.current.getLocaleText('noRowsLabel')}
        hint={hint}
        action={action}
      />
    </GridOverlay>
  );
}
