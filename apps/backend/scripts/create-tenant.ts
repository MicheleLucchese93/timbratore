import { v4 as uuidv4 } from 'uuid';
import { adminPool as pool } from '../src/lib/admin-db.js';

interface Args {
  ragione_sociale: string;
  email: string;
  max_admins?: number;
  max_users?: number;
  language?: 'it' | 'en';
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const out: Record<string, string> = {};
  for (const a of args) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m && m[1]) out[m[1]] = m[2] ?? '';
  }
  if (!out.ragione_sociale || !out.email) {
    throw new Error('Usage: create-tenant --ragione_sociale=ACME --email=admin@x.it [--max_admins=2 --max_users=20 --language=it]');
  }
  return {
    ragione_sociale: out.ragione_sociale,
    email: out.email,
    max_admins: out.max_admins ? Number(out.max_admins) : undefined,
    max_users: out.max_users ? Number(out.max_users) : undefined,
    language: (out.language as 'it' | 'en' | undefined) ?? 'it',
  };
}

async function main(): Promise<void> {
  const a = parseArgs();
  const existingUser = await pool.query(`SELECT id FROM auth_users WHERE email = $1`, [a.email]);
  const userId = existingUser.rowCount && existingUser.rows[0] ? existingUser.rows[0].id : uuidv4();
  if (existingUser.rowCount === 0) {
    await pool.query(`INSERT INTO auth_users(id, email) VALUES ($1, $2)`, [userId, a.email]);
  }
  const t = await pool.query(
    `INSERT INTO tenants(ragione_sociale, language, max_admins, max_users)
     VALUES ($1, $2, COALESCE($3, 2), COALESCE($4, 20))
     RETURNING id`,
    [a.ragione_sociale, a.language ?? 'it', a.max_admins ?? null, a.max_users ?? null]
  );
  const tenantId = t.rows[0].id;
  await pool.query(
    `INSERT INTO memberships(tenant_id, user_id, role) VALUES ($1, $2, 'admin')
     ON CONFLICT (tenant_id, user_id) DO UPDATE SET role='admin', active=TRUE, deleted_at=NULL`,
    [tenantId, userId]
  );
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ tenant_id: tenantId, user_id: userId, email: a.email }, null, 2));
  await pool.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
