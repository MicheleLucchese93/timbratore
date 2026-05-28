import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../store/session.ts';
import { Login } from '../pages/Login.tsx';
import { ForgotPassword } from '../pages/ForgotPassword.tsx';
import { Layout } from './Layout.tsx';
import { Dashboard } from '../pages/Dashboard.tsx';
import { Branches } from '../pages/Branches.tsx';
import { Users } from '../pages/Users.tsx';
import { Stamps } from '../pages/Stamps.tsx';
import { Corrections } from '../pages/Corrections.tsx';
import { Exports } from '../pages/Exports.tsx';
import { Settings } from '../pages/Settings.tsx';
import { Shifts } from '../pages/Shifts.tsx';
import { Anomalies } from '../pages/Anomalies.tsx';
import { Leaves } from '../pages/Leaves.tsx';
import { MyStamps } from '../pages/MyStamps.tsx';
import { MyDashboard } from '../pages/MyDashboard.tsx';
import { Manual } from '../pages/Manual.tsx';

export function App() {
  const { me, loading, refresh } = useSession();
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-neutral-500">
        Caricamento…
      </div>
    );
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
      </Layout>
    );
  }

  // role = user — own-data only, no admin pages.
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<MyDashboard />} />
        <Route path="/me/stamps" element={<MyStamps />} />
        <Route path="/me/corrections" element={<Corrections />} />
        <Route path="/manual" element={<Manual />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
