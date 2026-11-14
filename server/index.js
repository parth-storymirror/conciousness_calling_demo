// Server entry point.  Start with:  npm start   (production)   or   npm run dev   (local, in-memory, no emails)
const crypto = require("node:crypto");
const config = require("./config");
const { createDb } = require("./db");
const { migrate } = require("./schema");
const { createData } = require("./data");
const { createStorage } = require("./storage");
const { createMailer } = require("./mailer");
const { createCampaignService } = require("./campaigns");
const { createApp } = require("./app");
const { seedDefaults } = require("./seed");
const auth = require("./auth");

// Builds every part of the app. Tests call this with overrides and fake parts.
async function build(overrides = {}, parts = {}) {
  const cfg = config.load(overrides);
  if (!cfg.sessionSecret) {
    if (cfg.nodeEnv === "production" && !cfg.useMemoryDb) throw new Error("SESSION_SECRET is required in production (use a long random string).");
    cfg.sessionSecret = crypto.randomBytes(32).toString("hex"); // dev only: sessions end when the server restarts
  } else if (cfg.sessionSecret.length < 24) {
    throw new Error("SESSION_SECRET must be at least 24 characters.");
  }
  const db = parts.db || createDb(cfg);
  await migrate(db);
  const data = createData(db);
  await seedDefaults(data);
  await data.campaigns.markInterrupted(); // a restart never silently continues a send
  const storage = parts.storage || createStorage(cfg);
  const mailer = createMailer(cfg, parts.transport);
  const campaigns = createCampaignService({ data, mailer, cfg, delayMs: parts.delayMs ?? 250 });
  const app = createApp({ cfg, data, storage, campaigns });
  return { cfg, db, data, storage, mailer, campaigns, app };
}

async function main() {
  const ctx = await build();
  const { cfg, data } = ctx;

  if (cfg.useMemoryDb) {
    // Local mode: a throwaway admin so you can look around. The password is printed once and never stored.
    const pw = crypto.randomBytes(9).toString("base64url");
    await data.admins.upsert("admin", auth.hashPassword(pw));
    console.log("\n  LOCAL MODE: in-memory database, files on disk, email sending disabled.");
    console.log(`  Admin sign-in -> username: admin   password: ${pw}`);
  } else if ((await data.admins.count()) === 0) {
    console.log("\n  No admin account exists yet. Create one with:  npm run create-admin");
  }

  ctx.app.listen(cfg.port, () => {
    console.log(`  Website:  http://localhost:${cfg.port}`);
    console.log(`  Admin:    http://localhost:${cfg.port}${cfg.adminPath}/   (not linked from the website)`);
    console.log(`  Email sending: ${cfg.emailSendingEnabled ? "ENABLED" : "disabled"}\n`);
  });
}

if (require.main === module) {
  main().catch((e) => {
    console.error("Failed to start:", e.message);
    process.exit(1);
  });
}

module.exports = { build };
