
import "../config/env.js";
import { readdir, readFile } from "node:fs/promises";
import { pool } from "./pool.js";

const migrationsUrl = new URL("./migrations/", import.meta.url);

async function migrate() {
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const files = (await readdir(migrationsUrl))
      .filter((file) => /^\d+_[a-z0-9_]+\.sql$/.test(file))
      .sort();

    for (const name of files) {
      const existing = await client.query(
        "SELECT 1 FROM schema_migrations WHERE name = $1",
        [name]
      );

      if ((existing.rowCount ?? 0) > 0) {
        console.log(`Already applied: ${name}`);
        continue;
      }

      const sql = await readFile(new URL(name, migrationsUrl), "utf8");

      await client.query("BEGIN");

      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (name) VALUES ($1)",
          [name]
        );
        await client.query("COMMIT");
        console.log(`Applied: ${name}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error("Database migration failed:", error);
  process.exitCode = 1;
});
