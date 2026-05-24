import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../store/session.ts';
import { Login } from '../pages/Login.tsx';
import { Layout } from './Layout.tsx';
import { Dashboard } from '../pages/Dashboard.tsx';
import { Branches } from '../pages/Branches.tsx';
import { Users } from '../pages/Users.tsx';
import { Stamps } from '../pages/Stamps.tsx';
import { Corrections } from '../pages/Corrections.tsx';
import { Exports } from '../pages/Exports.tsx';
import { Settings } from '../pages/Settings.tsx';
import { Compliance } from '../pages/Compliance.tsx';

export function App() {
  const { me, loading, refresh, logout } = useSession();
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
        <Route path="*" element={<Navigate to="/login" state={{ from: loc.pathname }} replace />} />
      </Routes>
    );
  }

  if (me.user.role !== 'admin') {
    return (
      <div className="max-w-md mx-auto mt-16 card">
        <h1 className="text-xl font-semibold mb-2">Accesso limitato</h1>
        <p className="text-sm text-neutral-700 mb-4">
          Il pannello web è riservato agli amministratori — usa l'app mobile per timbrare.
        </p>
        <button className="btn btn-secondary" onClick={logout}>Esci</button>
      </div>
    );
  }

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
        <Route path="/compliance" element={<Compliance />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
