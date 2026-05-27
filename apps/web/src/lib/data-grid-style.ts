import type { DataGridProps } from '@mui/x-data-grid';

export const dataGridSx: NonNullable<DataGridProps['sx']> = {
  border: 0,
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
  pageSizeOptions: [25, 50, 100, 250],
  initialState: {
    pagination: { paginationModel: { pageSize: 100 } },
    density: 'compact' as const,
  },
  autoHeight: true,
  showToolbar: true,
  disableRowSelectionOnClick: true,
};
