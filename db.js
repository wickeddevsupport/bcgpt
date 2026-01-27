import knex from "knex";
import cfg from "./knexfile.cjs";

export const db = knex(cfg);
