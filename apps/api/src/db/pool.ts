
import "../config/env.js";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not configured");
}

export const pool = new Pool({
  connectionString,
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error:", error);
});
