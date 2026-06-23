import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from '../store/session.ts';
import { Login } from '../pages/Login.tsx';
import { Layout } from './Layout.tsx';
import { Tenants } from '../pages/Tenants.tsx';
import { Partners } from '../pages/Partners.tsx';
import { Audit } from '../pages/Audit.tsx';
import { Settings } from '../pages/Settings.tsx';

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
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  const isAdmin = me.role === 'admin';

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Tenants />} />
        {isAdmin && <Route path="/partners" element={<Partners />} />}
        <Route path="/audit" element={<Audit />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
