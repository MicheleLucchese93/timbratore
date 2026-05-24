import { Pool } from 'pg';
import { env } from '../env.js';

// Superuser/owner connection — for bootstrap, migrations, system queries
// that must read across tenants (membership lookup in auth middleware,
// scheduler jobs, retention sweeps, scripts).
// In production this is the <app> owner role; locally it's the OS user.
export const adminPool = new Pool({
  connectionString: env.ADMIN_DATABASE_URL ?? env.DATABASE_URL,
  max: 5,
});
