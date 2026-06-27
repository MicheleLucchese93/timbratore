import { BachecaScreen } from '../../screens/BachecaScreen';

// Bacheca is available to every member (admin + user) — unlike the admin-only
// dashboard. Composing messages is web-only; here it is read + mark-as-read.
export default function BachecaRoute() {
  return <BachecaScreen />;
}
