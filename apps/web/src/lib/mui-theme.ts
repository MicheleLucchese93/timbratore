import { createTheme } from '@mui/material/styles';
import { itIT as coreItIT } from '@mui/material/locale';
import { itIT as gridItIT } from '@mui/x-data-grid/locales';

export const muiTheme = createTheme(
  {
    palette: {
      mode: 'light',
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
  },
  coreItIT,
  gridItIT
);
