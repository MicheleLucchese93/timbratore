import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../store/session.ts';
import { getToken } from '../lib/api.ts';
import { applyServerLanguage } from '../i18n/index.ts';
import { Login } from '../pages/Login.tsx';
import { ForgotPassword } from '../pages/ForgotPassword.tsx';
import { ChooseTenant } from '../pages/ChooseTenant.tsx';
import { Layout } from './Layout.tsx';
import { ErrorBoundary } from '../components/ErrorBoundary.tsx';
import { AppShellSkeleton, PageSkeleton } from './Skeleton.tsx';

// Route pages are code-split so employees never download the admin-only
// MUI DataGrid / Google Maps chunks and first paint stays small. Pages are
// named exports, hence the { default: m.X } mapping React.lazy requires.
// Login / ForgotPassword / Layout stay eager (first paint + app shell).
const Dashboard = lazy(() => import('../pages/Dashboard.tsx').then((m) => ({ default: m.Dashboard })));
const Branches = lazy(() => import('../pages/Branches.tsx').then((m) => ({ default: m.Branches })));
const Users = lazy(() => import('../pages/Users.tsx').then((m) => ({ default: m.Users })));
const Stamps = lazy(() => import('../pages/Stamps.tsx').then((m) => ({ default: m.Stamps })));
const Corrections = lazy(() => import('../pages/Corrections.tsx').then((m) => ({ default: m.Corrections })));
const Exports = lazy(() => import('../pages/Exports.tsx').then((m) => ({ default: m.Exports })));
const Settings = lazy(() => import('../pages/Settings.tsx').then((m) => ({ default: m.Settings })));
const Shifts = lazy(() => import('../pages/Shifts.tsx').then((m) => ({ default: m.Shifts })));
const Anomalies = lazy(() => import('../pages/Anomalies.tsx').then((m) => ({ default: m.Anomalies })));
const Leaves = lazy(() => import('../pages/Leaves.tsx').then((m) => ({ default: m.Leaves })));
const MyStamps = lazy(() => import('../pages/MyStamps.tsx').then((m) => ({ default: m.MyStamps })));
const MyLeaves = lazy(() => import('../pages/MyLeaves.tsx').then((m) => ({ default: m.MyLeaves })));
const MyDashboard = lazy(() => import('../pages/MyDashboard.tsx').then((m) => ({ default: m.MyDashboard })));
const Manual = lazy(() => import('../pages/Manual.tsx').then((m) => ({ default: m.Manual })));

export function App() {
  const { me, loading, tenants, activeTenantId, refresh } = useSession();
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Apply the per-user language preference once /me resolves.
  useEffect(() => {
    applyServerLanguage(me?.preferences?.language);
  }, [me?.preferences?.language]);

  if (loading) {
    return <AppShellSkeleton />;
  }

  // Authenticated but a member of several companies with none chosen yet:
  // pick one before any role-specific UI loads.
  if (!me && getToken() && tenants.length > 1 && !activeTenantId) {
    return <ChooseTenant />;
  }

  if (!me) {
    return (
      <Routes>
        <Route path="/login" element={<Login onLoggedIn={() => nav('/')} />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="*" element={<Navigate to="/login" state={{ from: loc.pathname }} replace />} />
      </Routes>
    );
  }

  if (me.user.role === 'admin') {
    return (
      <Layout>
        <ErrorBoundary key={loc.pathname}>
          <Suspense fallback={<PageSkeleton />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/branches" element={<Branches />} />
              <Route path="/users" element={<Users />} />
              <Route path="/stamps" element={<Stamps />} />
              <Route path="/corrections" element={<Corrections />} />
              <Route path="/exports" element={<Exports />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/shifts" element={<Shifts />} />
              <Route path="/anomalies" element={<Anomalies />} />
              <Route path="/leaves" element={<Leaves />} />
              <Route path="/manual" element={<Manual />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </Layout>
    );
  }

  // role = user — own-data only, no admin pages.
  return (
    <Layout>
      <ErrorBoundary key={loc.pathname}>
        <Suspense fallback={<PageSkeleton />}>
          <Routes>
            <Route path="/" element={<MyDashboard />} />
            <Route path="/me/stamps" element={<MyStamps />} />
            <Route path="/me/corrections" element={<Corrections />} />
            <Route path="/me/leaves" element={<MyLeaves />} />
            <Route path="/manual" element={<Manual />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </Layout>
  );
}
