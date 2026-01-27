import knex from "knex";
import cfg from "./knexfile.cjs";

export const db = knex(cfg);

export async function ensureDataDir() {
  // SQLite needs the directory to exist
  const fs = await import("fs");
  const path = await import("path");

  const file = cfg.connection.filename;
  const dir = path.dirname(file);

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
