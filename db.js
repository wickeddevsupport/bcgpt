import pg from "pg";
const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.warn("Missing DATABASE_URL (set it in Render Environment)");
}

const isRender = Boolean(process.env.RENDER);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isRender ? { rejectUnauthorized: false } : undefined,
});

export async function q(text, params) {
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    return res;
  } finally {
    client.release();
  }
}
