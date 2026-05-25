import { v4 as uuidv4 } from 'uuid';
import { adminPool as pool } from '../src/lib/admin-db.js';

async function ensureUser(email: string): Promise<string> {
  const existing = await pool.query(`SELECT id FROM auth_users WHERE email = $1`, [email]);
  if (existing.rowCount && existing.rows[0]) return existing.rows[0].id;
  const id = uuidv4();
  await pool.query(`INSERT INTO auth_users(id, email) VALUES ($1, $2)`, [id, email]);
  return id;
}

async function main(): Promise<void> {
  const tenants = await pool.query(`SELECT id FROM tenants WHERE ragione_sociale = 'Demo Bar Centrale Srl'`);
  if (tenants.rowCount && tenants.rowCount > 0) {
    // eslint-disable-next-line no-console
    console.log('Seed already applied');
    await pool.end();
    return;
  }
  const adminId = await ensureUser('admin@demo.sonoqui.local');
  const userId = await ensureUser('mario.rossi@demo.sonoqui.local');
  const t = await pool.query(
    `INSERT INTO tenants(ragione_sociale, language, max_admins, max_users)
     VALUES ('Demo Bar Centrale Srl', 'it', 2, 10) RETURNING id`
  );
  const tenantId = t.rows[0].id;
  await pool.query(
    `INSERT INTO memberships(tenant_id, user_id, role) VALUES ($1, $2, 'admin'), ($1, $3, 'user')`,
    [tenantId, adminId, userId]
  );
  // Branch in Rome — Piazza Venezia coordinates.
  const b = await pool.query(
    `INSERT INTO branches(tenant_id, name, address, latitude, longitude, radius_m)
     VALUES ($1, 'Bar Centrale - Piazza Venezia', 'Piazza Venezia, 00187 Roma', 41.8957, 12.4823, 300)
     RETURNING id`,
    [tenantId]
  );
  const branchId = b.rows[0].id;
  await pool.query(
    `INSERT INTO branch_memberships(branch_id, user_id, tenant_id) VALUES ($1, $2, $3), ($1, $4, $3)`,
    [branchId, adminId, tenantId, userId]
  );
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ tenant_id: tenantId, admin: { id: adminId, email: 'admin@demo.sonoqui.local' }, user: { id: userId, email: 'mario.rossi@demo.sonoqui.local' }, branch_id: branchId }, null, 2));
  await pool.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
