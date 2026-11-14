// Database access. Production: PostgreSQL via DATABASE_URL. Local/test: in-memory Postgres (pg-mem).
// The in-memory mode never touches the real database.
function createDb(cfg) {
  if (cfg.useMemoryDb) {
    const { newDb } = require("pg-mem");
    const mem = newDb();
    const { Pool } = mem.adapters.createPg();
    return new Pool();
  }
  if (!cfg.databaseUrl) throw new Error("DATABASE_URL is not set (or set USE_MEMORY_DB=true for local testing).");
  const { Pool } = require("pg");
  const needsSsl = /sslmode=require|ssl=true/i.test(cfg.databaseUrl);
  return new Pool({
    connectionString: cfg.databaseUrl,
    max: 8,
    idleTimeoutMillis: 30000,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });
}

module.exports = { createDb };
