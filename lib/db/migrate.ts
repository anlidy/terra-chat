import dns from "node:dns";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

config({
  path: ".env.local",
});

dns.setDefaultResultOrder("ipv4first");

export const runMigrate = async () => {
  if (!process.env.POSTGRES_URL) {
    console.log("⏭️  POSTGRES_URL not defined, skipping migrations");
    return;
  }

  const connection = postgres(process.env.POSTGRES_URL, { max: 1 });
  const db = drizzle(connection);

  try {
    console.log("⏳ Running migrations...");

    const start = Date.now();
    await migrate(db, { migrationsFolder: "./lib/db/migrations" });
    const end = Date.now();

    console.log("✅ Migrations completed in", end - start, "ms");
  } finally {
    await connection.end();
  }
};

if (require.main === module) {
  runMigrate().catch((err) => {
    console.error("❌ Migration failed");
    console.error(err);
    process.exitCode = 1;
  });
}
