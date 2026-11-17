// Express application: serves the website, the public API and the hidden admin.
const path = require("node:path");
const fs = require("node:fs");
const express = require("express");
const helmet = require("helmet");
const { createPublicRouter } = require("./routes/public");
const { createAdminRouter } = require("./routes/admin");
const { HttpError } = require("./validate");

const ROOT = path.resolve(__dirname, "..");
const PAGE_RE = /^\/([a-z0-9][a-z0-9-]*)\.html$/;

function createApp({ cfg, data, storage, campaigns }) {
  const app = express();
  app.disable("x-powered-by");
  if (cfg.trustProxy) app.set("trust proxy", /^\d+$/.test(cfg.trustProxy) ? Number(cfg.trustProxy) : cfg.trustProxy);

  const imgSources = ["'self'", "data:"];
  if (cfg.bucket.canonicalUrl) imgSources.push(cfg.bucket.canonicalUrl);

  // Pages use a few inline scripts/styles, so the public site allows 'unsafe-inline'; the admin does not.
  const siteHelmet = helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "'unsafe-inline'"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["https://fonts.gstatic.com"],
        "img-src": imgSources,
        "connect-src": ["'self'"],
        "object-src": ["'none'"],
        "base-uri": ["'self'"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  const adminHelmet = helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        "default-src": ["'none'"],
        "script-src": ["'self'"],
        "style-src": ["'self'"],
        "style-src-attr": ["'unsafe-inline'"], // the admin sets a few inline style attributes; it never inserts HTML
        "font-src": ["'self'"],
        "img-src": imgSources,
        "connect-src": ["'self'"],
        "base-uri": ["'none'"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "no-referrer" },
  });

  // ---- admin (hidden path, never linked from the website) -------------------------------
  const adminDir = path.join(ROOT, "admin");
  app.use(cfg.adminPath, adminHelmet, (req, res, next) => {
    res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(`${cfg.adminPath}/api`, createAdminRouter({ cfg, data, storage, campaigns }));
  app.use(`${cfg.adminPath}/static`, express.static(adminDir, { dotfiles: "ignore", index: false, maxAge: 0 }));
  app.get([cfg.adminPath, `${cfg.adminPath}/`], (req, res) => {
    const pathOnly = req.originalUrl.split("?")[0];
    if (!pathOnly.endsWith("/")) return res.redirect(302, `${cfg.adminPath}/`);
    res.sendFile(path.join(adminDir, "index.html"));
  });

  // ---- public site --------------------------------------------------------------------------
  app.use(siteHelmet);
  app.use(createPublicRouter({ data, cfg }));

  if (storage.driver === "local") {
    // Local mode only: serve files saved on disk (never used with the real bucket).
    app.use("/uploads-dev", express.static(storage.root, { dotfiles: "ignore", index: false }));
  }

  const cdnBase = cfg.bucket.canonicalUrl ? `${cfg.bucket.canonicalUrl}/${cfg.storagePrefix}/site/${cfg.siteImagesVersion ? cfg.siteImagesVersion + "/" : ""}` : "";
  const rewrite = (text) => (cfg.siteImagesOnCdn && cdnBase ? text.replace(/(\.\.\/)?(\/)?assets\/img\//g, cdnBase) : text);
  const cache = new Map();
  const sendTransformed = async (file, type, res) => {
    const stat = await fs.promises.stat(file);
    const hit = cache.get(file);
    let body;
    if (hit && hit.mtime === stat.mtimeMs) body = hit.body;
    else {
      body = rewrite(await fs.promises.readFile(file, "utf8"));
      cache.set(file, { mtime: stat.mtimeMs, body });
    }
    res.type(type).set("Cache-Control", "no-cache").send(body);
  };

  // ---- search engines ---------------------------------------------------------------------------
  // The public pages are open to search engines. The admin is NOT listed here on purpose (listing it
  // would advertise the hidden path); it is kept out of search by its own noindex header and meta tag.
  const SITEMAP_PAGES = ["", "about.html", "vision.html", "mission.html", "great-transition.html", "master-light.html",
    "book.html", "explore.html", "inner-sun.html", "light-code.html", "my-writing.html", "faqs.html", "downloads.html", "connect.html"];
  const siteOrigin = (req) => cfg.siteUrl || `${req.protocol}://${req.get("host")}`;
  app.get("/robots.txt", (req, res) => {
    res.type("text/plain").set("Cache-Control", "public, max-age=3600")
      .send(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /unsubscribe\n\nSitemap: ${siteOrigin(req)}/sitemap.xml\n`);
  });
  app.get("/sitemap.xml", (req, res) => {
    const base = siteOrigin(req);
    const urls = SITEMAP_PAGES.map((p) => `  <url><loc>${base}/${p}</loc></url>`).join("\n");
    res.type("application/xml").set("Cache-Control", "public, max-age=3600")
      .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
  });

  app.get("/", (req, res, next) => sendTransformed(path.join(ROOT, "index.html"), "html", res).catch(next));
  app.get(PAGE_RE, async (req, res, next) => {
    const file = path.join(ROOT, `${req.path.slice(1)}`);
    try {
      await fs.promises.access(file);
      await sendTransformed(file, "html", res);
    } catch { next(); }
  });
  if (cfg.siteImagesOnCdn) {
    app.get("/css/style.css", (req, res, next) => sendTransformed(path.join(ROOT, "css", "style.css"), "css", res).catch(next));
    app.get("/js/site.js", (req, res, next) => sendTransformed(path.join(ROOT, "js", "site.js"), "js", res).catch(next));
  }
  const staticOpts = { dotfiles: "ignore", index: false };
  app.use("/css", express.static(path.join(ROOT, "css"), { ...staticOpts, maxAge: 0 }));
  app.use("/js", express.static(path.join(ROOT, "js"), { ...staticOpts, maxAge: 0 }));
  app.use("/assets", express.static(path.join(ROOT, "assets"), { ...staticOpts, maxAge: "1d" }));

  app.get("/healthz", (req, res) => res.json({ ok: true }));

  app.use((req, res) => {
    if (req.path.includes("/api/") || req.path.startsWith("/api")) return res.status(404).json({ error: "Not found." });
    res.status(404).sendFile(path.join(ROOT, "index.html"));
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let status = 500;
    let message = "Something went wrong.";
    if (err instanceof HttpError) { status = err.status; message = err.message; }
    else if (err && err.type === "entity.parse.failed") { status = 400; message = "Invalid request."; }
    else if (err && err.type === "entity.too.large") { status = 413; message = "Request is too large."; }
    else if (err) console.error("Server error:", err.message);
    if (res.headersSent) return;
    res.status(status).json({ error: message });
  });

  return app;
}

module.exports = { createApp };
