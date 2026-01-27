import knex from "knex";
import cfg from "./knexfile.cjs";
import fs from "fs";
import path from "path";

// Ensure directory exists
const dbFile = cfg.connection.filename;
const dir = path.dirname(dbFile);

try {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
} catch (e) {
  console.error("Failed to create SQLite directory:", dir, e);
}

export const db = knex(cfg);
