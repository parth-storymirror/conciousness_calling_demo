// Database schema. Safe to run repeatedly (CREATE TABLE IF NOT EXISTS).
const statements = [
  `CREATE TABLE IF NOT EXISTS admins (
     id SERIAL PRIMARY KEY,
     username TEXT NOT NULL UNIQUE,
     password_hash TEXT NOT NULL,
     created_at TIMESTAMP NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS subscribers (
     id SERIAL PRIMARY KEY,
     email TEXT NOT NULL UNIQUE,
     name TEXT,
     status TEXT NOT NULL DEFAULT 'active',
     token TEXT NOT NULL UNIQUE,
     source TEXT,
     created_at TIMESTAMP NOT NULL DEFAULT now(),
     unsubscribed_at TIMESTAMP
   )`,
  `CREATE TABLE IF NOT EXISTS campaigns (
     id SERIAL PRIMARY KEY,
     subject TEXT NOT NULL,
     body TEXT NOT NULL,
     status TEXT NOT NULL,
     total INT NOT NULL DEFAULT 0,
     sent INT NOT NULL DEFAULT 0,
     failed INT NOT NULL DEFAULT 0,
     created_by TEXT,
     created_at TIMESTAMP NOT NULL DEFAULT now(),
     finished_at TIMESTAMP
   )`,
  `CREATE TABLE IF NOT EXISTS campaign_recipients (
     id SERIAL PRIMARY KEY,
     campaign_id INT NOT NULL,
     subscriber_id INT NOT NULL,
     email TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'pending',
     error TEXT,
     sent_at TIMESTAMP
   )`,
  `CREATE TABLE IF NOT EXISTS site_settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL,
     updated_at TIMESTAMP NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS uploaded_files (
     id SERIAL PRIMARY KEY,
     kind TEXT NOT NULL,
     storage_key TEXT NOT NULL,
     url TEXT NOT NULL,
     original_name TEXT NOT NULL,
     mime TEXT,
     size INT,
     created_at TIMESTAMP NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS writing_blocks (
     id SERIAL PRIMARY KEY,
     position INT NOT NULL,
     type TEXT NOT NULL,
     data TEXT NOT NULL,
     created_at TIMESTAMP NOT NULL DEFAULT now(),
     updated_at TIMESTAMP NOT NULL DEFAULT now()
   )`,
];

async function migrate(db) {
  for (const sql of statements) await db.query(sql);
}

module.exports = { migrate, statements };
