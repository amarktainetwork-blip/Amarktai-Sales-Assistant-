import "dotenv/config";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required to run production migrations.");
  const migrationsFolder = process.env.DRIZZLE_MIGRATIONS_DIR?.trim() || "/app/drizzle";
  const connection = await mysql.createConnection(databaseUrl);
  try {
    const db = drizzle(connection);
    await migrate(db, { migrationsFolder });
    console.log(JSON.stringify({ event: "production_migrations_complete", migrationsFolder }));
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error(JSON.stringify({ event: "production_migrations_failed", detail: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500) }));
  process.exitCode = 1;
});
