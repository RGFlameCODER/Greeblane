import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const { Pool } = pg;
if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL. Copy .env.example to .env and configure PostgreSQL.");
  process.exit(1);
}
const ssl = String(process.env.DATABASE_SSL || "false").toLowerCase() === "true"
  ? { rejectUnauthorized: true }
  : false;
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});
pool.on("error", (err) => console.error("Unexpected PostgreSQL pool error:", err.message));
export async function query(text, params = []) {
  return pool.query(text, params);
}
