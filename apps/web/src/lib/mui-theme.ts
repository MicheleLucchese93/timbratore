import { createTheme } from '@mui/material/styles';
import { itIT as coreItIT, enUS as coreEnUS } from '@mui/material/locale';
import { itIT as gridItIT, enUS as gridEnUS } from '@mui/x-data-grid/locales';
import { color } from '@sonoqui/shared';

const baseTheme = {
  palette: {
    mode: 'light' as const,
    primary: { main: color.primary, contrastText: color.onPrimary },
    secondary: { main: color.secondary, contrastText: color.onSecondary },
    error: { main: color.error },
    success: { main: color.success },
    warning: { main: color.warning },
    background: { default: color.surface, paper: '#ffffff' },
    text: { primary: color.onSurface, secondary: color.onSurfaceVariant },
    divider: color.surfaceVariant,
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    fontSize: 13,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: color.surface },
      },
    },
  },
};

/** Theme localised for MUI core + DataGrid strings (pagination, filters, etc.). */
export function makeMuiTheme(lang: string) {
  const core = lang === 'en' ? coreEnUS : coreItIT;
  const grid = lang === 'en' ? gridEnUS : gridItIT;
  return createTheme(baseTheme, core, grid);
}
