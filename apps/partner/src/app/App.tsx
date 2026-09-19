import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from '../store/session.ts';
import { Login } from '../pages/Login.tsx';
import { ForgotPassword } from '../pages/ForgotPassword.tsx';
import { Layout } from './Layout.tsx';
import { Tenants } from '../pages/Tenants.tsx';
import { Tickets } from '../pages/Tickets.tsx';
import { Partners } from '../pages/Partners.tsx';
import { Audit } from '../pages/Audit.tsx';
import { Settings } from '../pages/Settings.tsx';
import { Manual } from '../pages/Manual.tsx';
import { Signups } from '../pages/Signups.tsx';
import { Payments } from '../pages/Payments.tsx';

export function App() {
  const { me, loading, refresh } = useSession();

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading) {
    return (
      <div className="sq-boot" aria-busy="true">
        <div className="sq-boot-ring" />
      </div>
    );
  }

  if (!me) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  const isAdmin = me.role === 'admin';
  // Self-service signups and the payments ledger belong to the super-user alone
  // (the API answers 403 SUPER_ADMIN_REQUIRED to everyone else).
  const isSuper = me.is_super === true;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Tenants />} />
        <Route path="/tickets" element={<Tickets />} />
        {isAdmin && <Route path="/partners" element={<Partners />} />}
        {isSuper && <Route path="/signups" element={<Signups />} />}
        {isSuper && <Route path="/payments" element={<Payments />} />}
        <Route path="/audit" element={<Audit />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/manual" element={<Manual />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
