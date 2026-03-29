import { Client } from "./server/node_modules/pg/lib/index.js";

const databaseUrl = process.env.DATABASE_URL;
const adminEmail = (process.env.PAPERCLIP_BOOTSTRAP_ADMIN_EMAIL || "").trim().toLowerCase();
const adminName = (process.env.PAPERCLIP_BOOTSTRAP_ADMIN_NAME || "Rajan").trim() || "Rajan";

if (!databaseUrl || !adminEmail) {
  process.exit(0);
}

const client = new Client({ connectionString: databaseUrl });

async function main() {
  await client.connect();
  const userRes = await client.query(
    'select id, name, email from "user" where lower(email) = $1 order by created_at asc limit 1',
    [adminEmail],
  );
  if (userRes.rowCount === 0) {
    console.log(`[paperclip-bootstrap-admin] waiting for user signup: ${adminEmail}`);
    return;
  }
  const user = userRes.rows[0];
  await client.query(
    `insert into instance_user_roles (user_id, role)
     values ($1, 'instance_admin')
     on conflict (user_id, role) do nothing`,
    [user.id],
  );
  await client.query(
    `update "user" set name = coalesce(nullif(name, ''), $2), updated_at = now() where id = $1`,
    [user.id, adminName],
  );
  console.log(`[paperclip-bootstrap-admin] ensured instance_admin for ${user.email} (${user.id})`);
}

main()
  .catch((error) => {
    console.error("[paperclip-bootstrap-admin] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end().catch(() => {});
  });
