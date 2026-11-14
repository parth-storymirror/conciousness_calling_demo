// Creates (or resets the password of) an admin account in the configured database.
//   npm run create-admin
// The password is typed at a hidden prompt, never passed on the command line, and only its hash is stored.
const readline = require("node:readline");
const config = require("../server/config");
const { createDb } = require("../server/db");
const { migrate } = require("../server/schema");
const { createData } = require("../server/data");
const auth = require("../server/auth");

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      const orig = rl._writeToOutput;
      rl._writeToOutput = function (s) { if (s.includes(question)) orig.call(rl, s); };
    }
    rl.question(question, (answer) => { rl.close(); if (hidden) process.stdout.write("\n"); resolve(answer); });
  });
}

(async () => {
  const cfg = config.load({ useMemoryDb: false });
  if (!cfg.databaseUrl) { console.error("DATABASE_URL is not set."); process.exit(1); }
  const username = (await ask("Admin username: ")).trim().toLowerCase();
  if (!/^[a-z0-9._@+-]{3,80}$/.test(username)) { console.error("Use 3-80 letters, numbers or . _ @ + -"); process.exit(1); }
  const pw1 = await ask("Password (min 10 characters, letters and a number): ", { hidden: true });
  const problem = auth.passwordProblem(pw1);
  if (problem) { console.error(problem); process.exit(1); }
  const pw2 = await ask("Repeat password: ", { hidden: true });
  if (pw1 !== pw2) { console.error("Passwords do not match."); process.exit(1); }

  const db = createDb(cfg);
  try {
    await migrate(db);
    const data = createData(db);
    await data.admins.upsert(username, auth.hashPassword(pw1));
    console.log(`Admin "${username}" is ready.`);
  } finally {
    await db.end();
  }
})().catch((e) => { console.error("Failed:", e.message); process.exit(1); });
