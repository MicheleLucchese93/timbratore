import { Redirect } from 'expo-router';
import { useSession } from '../../store/session';
import { DashboardScreen } from '../../screens/DashboardScreen';

export default function DashboardRoute() {
  const me = useSession((s) => s.me);
  // Dashboard is admin-only (backend endpoints require admin). A non-admin
  // reaching this route via deep link is bounced to their stamp screen.
  if (me && me.user.role !== 'admin') return <Redirect href="/timbrature" />;
  return <DashboardScreen />;
}
