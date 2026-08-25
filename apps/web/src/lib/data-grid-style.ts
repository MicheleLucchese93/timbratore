import type { DataGridProps } from '@mui/x-data-grid';
import { GridEmptyOverlay } from '../components/GridEmptyOverlay.tsx';

export const dataGridSx: NonNullable<DataGridProps['sx']> = {
  border: 0,
  // Room for the illustrated empty body. With `autoHeight` the grid otherwise
  // reserves two row heights for the no-rows overlay, which crops the scene.
  '--DataGrid-overlayHeight': '17rem',
  '& .MuiDataGrid-columnHeaders': {
    background: 'color-mix(in oklab, var(--color-surface-variant) 55%, white)',
    textTransform: 'uppercase',
    fontSize: '0.75rem',
    letterSpacing: '0.06em',
  },
  '& .MuiDataGrid-columnHeader, & .MuiDataGrid-columnHeader--alignCenter, & .MuiDataGrid-columnHeader--alignRight':
    {
      borderRight: 0,
      textAlign: 'left',
    },
  '& .MuiDataGrid-columnHeaderTitleContainer, & .MuiDataGrid-columnHeaderTitleContainerContent': {
    justifyContent: 'flex-start',
  },
  '& .MuiDataGrid-cell, & .MuiDataGrid-cell--alignCenter, & .MuiDataGrid-cell--alignRight': {
    borderRight: 0,
    borderBottom: 0,
    justifyContent: 'flex-start',
    textAlign: 'left',
  },
  '& .MuiDataGrid-row.Mui-selected': {
    background: 'color-mix(in oklab, var(--color-primary-container) 45%, white)',
  },
  '& .MuiDataGrid-row:hover': {
    background: 'color-mix(in oklab, var(--color-primary-container) 25%, white)',
  },
};

export const dataGridDefaults = {
  // Every grid in the app gets the illustrated empty body: a table filtered
  // down to nothing looks identical to one that failed to load when the only
  // difference is six words of Helvetica. Pass `slotProps.noRowsOverlay` to say
  // something more specific than the grid's `noRowsLabel`.
  slots: { noRowsOverlay: GridEmptyOverlay },
  pageSizeOptions: [25, 50, 100, 250],
  initialState: {
    pagination: { paginationModel: { pageSize: 100 } },
    density: 'compact' as const,
  },
  autoHeight: true,
  showToolbar: true,
  disableRowSelectionOnClick: true,
};
