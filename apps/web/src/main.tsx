import React, { useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { App } from './app/App.tsx';
import { ConfirmProvider } from './components/ConfirmDialog.tsx';
import { makeMuiTheme } from './lib/mui-theme.ts';
import './i18n/index.ts';
import './index.css';

function Root() {
  // Recompute the MUI theme (core + DataGrid locale) whenever the language changes.
  const { i18n } = useTranslation();
  const theme = useMemo(() => makeMuiTheme(i18n.language), [i18n.language]);
  return (
    <ThemeProvider theme={theme}>
      <BrowserRouter>
        <ConfirmProvider>
          <App />
        </ConfirmProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
