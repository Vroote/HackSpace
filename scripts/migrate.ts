import { readFile } from "node:fs/promises";
import { database } from "../lib/db";

async function migrate() {
  const sql = await readFile(new URL("../db/schema.sql", import.meta.url), "utf8");
  const pool = database();
  try {
    await pool.query(sql);
    console.log("PostgreSQL schema is ready.");
  } finally {
    await pool.end();
  }
}

migrate().catch(() => {
  console.error("Could not apply the PostgreSQL schema. Check DATABASE_URL and database permissions.");
  process.exitCode = 1;
});
