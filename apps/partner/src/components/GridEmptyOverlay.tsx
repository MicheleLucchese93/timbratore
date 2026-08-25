import type { ComponentProps, ReactNode } from 'react';
import { GridOverlay, useGridApiContext } from '@mui/x-data-grid';
import { EmptyState } from './EmptyState.tsx';
import type { EmptyArtName } from './EmptyArt.tsx';

/**
 * Extra props this console's no-rows overlay accepts through `slotProps`.
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
 * Pass it as `slots={{ noRowsOverlay: GridEmptyOverlay }}` and say what is
 * missing through `slotProps.noRowsOverlay`; with no `title` it falls back to
 * the grid's own `noRowsLabel`.
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
      // body that reads as a panel around a sentence saying nothing is there.
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
