// Uploads the website's own images (only the ones the pages actually use) to this site's folder in the bucket.
//   npm run upload-site-images                          -> DRY RUN: lists what would be uploaded
//   npm run upload-site-images -- --apply --version v2  -> uploads to <prefix>/site/v2/ and points My Writings images there
// Use a new --version whenever images change, so browsers and the CDN never show an old cached copy.
// Then set SITE_IMAGES_ON_CDN=true and SITE_IMAGES_VERSION=<same version> and restart the server.
const fs = require("node:fs");
const path = require("node:path");
const config = require("../server/config");
const { createStorage } = require("../server/storage");
const { createDb } = require("../server/db");
const { createData } = require("../server/data");

const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" };

function referencedImages(all) {
  const text = [];
  for (const dir of ["", "css", "js"]) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) {
      if (/\.(html|css|js)$/.test(f)) text.push(fs.readFileSync(path.join(ROOT, dir, f), "utf8"));
    }
  }
  text.push(fs.readFileSync(path.join(ROOT, "server", "seed.js"), "utf8"));
  const joined = text.join("\n");
  return all.filter((f) => joined.includes(`assets/img/${f}`));
}

(async () => {
  const apply = process.argv.includes("--apply");
  const vi = process.argv.indexOf("--version");
  const version = (vi > -1 ? process.argv[vi + 1] : process.env.SITE_IMAGES_VERSION || "").replace(/[^\w.-]/g, "");
  const cfg = config.load({ useMemoryDb: false });
  const dir = path.join(ROOT, "assets", "img");
  const all = fs.readdirSync(dir).filter((f) => TYPES[path.extname(f).toLowerCase()]);
  const files = referencedImages(all);
  const folder = `${cfg.storagePrefix}/site${version ? "/" + version : ""}`;
  const total = files.reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
  console.log(`${files.length} images in use (of ${all.length} files), ${(total / 1048576).toFixed(1)} MB -> folder "${folder}/"`);
  if (!apply) {
    files.forEach((f) => console.log("  would upload:", f));
    console.log("\nDry run only. Nothing was uploaded. Re-run with --apply to upload.");
    return;
  }
  if (cfg.storageDriver !== "s3") { console.error("Bucket is not configured (BUCKET_* variables)."); process.exit(1); }
  const storage = createStorage(cfg);
  for (const f of files) {
    const key = `${folder}/${f}`;
    await storage.putAt({ key, buffer: fs.readFileSync(path.join(dir, f)), contentType: TYPES[path.extname(f).toLowerCase()] });
    console.log("  uploaded:", key);
  }
  // Point My Writings image blocks that use a site image at this version.
  if (cfg.databaseUrl) {
    const db = createDb(cfg);
    try {
      const data = createData(db);
      const base = `${cfg.bucket.canonicalUrl}/${folder}/`;
      for (const b of await data.writings.list()) {
        const m = b.type === "image" && /(?:\/assets\/img\/|\/site\/(?:v[\w.-]+\/)?)([^/]+)$/.exec(b.data.url || "");
        if (m && files.includes(m[1])) {
          await data.writings.update(b.id, { ...b.data, url: base + m[1] });
          console.log("  updated My Writings image block", b.id);
        }
      }
    } finally { await db.end(); }
  }
  console.log(`\nDone. Set SITE_IMAGES_ON_CDN=true and SITE_IMAGES_VERSION=${version || "(none)"} and restart the server.`);
})().catch((e) => { console.error("Failed:", e.message); process.exit(1); });
