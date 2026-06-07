import { createTheme } from '@mui/material/styles';
import { itIT as coreItIT, enUS as coreEnUS } from '@mui/material/locale';
import { itIT as gridItIT, enUS as gridEnUS } from '@mui/x-data-grid/locales';

const baseTheme = {
  palette: {
    mode: 'light' as const,
    primary: { main: '#b25500', contrastText: '#ffffff' },
    secondary: { main: '#514440' },
    error: { main: '#ba1a1a' },
    success: { main: '#1e7a3a' },
    warning: { main: '#a67700' },
    background: { default: '#fffbf8', paper: '#ffffff' },
    text: { primary: '#1f1b16', secondary: '#514440' },
    divider: '#f3ece5',
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    fontSize: 13,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: '#fffbf8' },
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
