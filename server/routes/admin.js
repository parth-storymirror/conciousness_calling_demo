// Admin API (mounted under the hidden admin path). Every route except login requires a valid session,
// and every state-changing request also needs the CSRF token.
const express = require("express");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const auth = require("../auth");
const { HttpError, bad, str, normalizeEmail, validateBlock, classifyUpload, normalizeBanner, validateBanner, normalizeDownloads, validateDownloads, downloadFileIds } = require("../validate");

const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_FILE = 100 * 1024 * 1024;

function createAdminRouter({ cfg, data, storage, campaigns }) {
  const r = express.Router();
  r.use(express.json({ limit: "1mb" }));
  r.use((req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE, files: 1 } }).single("file");

  // ---- login (rate limited, with a per-account lockout) ----------------------
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false,
    message: { error: "Too many sign-in attempts. Try again later." },
  });
  const failures = new Map(); // username -> { count, until }
  const lockedOut = (u) => { const f = failures.get(u); return f && f.until > Date.now() && f.count >= 5; };
  const noteFailure = (u) => {
    const f = failures.get(u);
    const now = Date.now();
    if (!f || f.until < now) failures.set(u, { count: 1, until: now + 15 * 60 * 1000 });
    else f.count++;
  };

  const isSecure = (req) => req.secure || cfg.nodeEnv === "production";

  r.post("/login", loginLimiter, async (req, res, next) => {
    try {
      const username = str(req.body && req.body.username, 80).toLowerCase();
      const password = typeof (req.body && req.body.password) === "string" ? req.body.password : "";
      if (!username || !password) throw bad("Enter your username and password.");
      if (lockedOut(username)) throw new HttpError(429, "This account is temporarily locked. Try again in 15 minutes.");
      const admin = await data.admins.byUsername(username);
      const ok = auth.verifyPassword(password, admin ? admin.password_hash : auth.DUMMY_HASH);
      if (!admin || !ok) {
        noteFailure(username);
        throw new HttpError(401, "Invalid username or password.");
      }
      failures.delete(username);
      const { token, payload } = auth.createSession(cfg.sessionSecret, { uid: admin.id, username: admin.username }, cfg.sessionHours);
      res.cookie(auth.COOKIE, token, auth.cookieOptions(cfg, isSecure(req)));
      res.json({ username: admin.username, csrf: payload.csrf });
    } catch (e) { next(e); }
  });

  // ---- everything below needs a session ------------------------------------------
  const requireAuth = (req, res, next) => {
    const token = auth.parseCookies(req.headers.cookie)[auth.COOKIE];
    const session = auth.readSession(cfg.sessionSecret, token);
    if (!session) return next(new HttpError(401, "Please sign in."));
    req.admin = session;
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const sent = req.headers["x-csrf-token"];
      if (typeof sent !== "string" || sent !== session.csrf) return next(new HttpError(403, "Security check failed. Reload the page."));
      const origin = req.headers.origin;
      if (origin) {
        try { if (new URL(origin).host !== req.headers.host) return next(new HttpError(403, "Blocked request origin.")); } catch { return next(new HttpError(403, "Blocked request origin.")); }
      }
    }
    next();
  };

  r.post("/logout", (req, res) => {
    res.clearCookie(auth.COOKIE, { path: cfg.adminPath });
    res.json({ ok: true });
  });

  r.get("/me", requireAuth, (req, res) => res.json({ username: req.admin.username, csrf: req.admin.csrf }));

  r.post("/password", requireAuth, async (req, res, next) => {
    try {
      const { current, next: next1 } = req.body || {};
      const admin = await data.admins.byId(req.admin.uid);
      if (!admin || !auth.verifyPassword(String(current || ""), admin.password_hash)) throw new HttpError(400, "Your current password is not correct.");
      const problem = auth.passwordProblem(next1);
      if (problem) throw bad(problem);
      await data.admins.setPassword(admin.id, auth.hashPassword(next1));
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  r.get("/status", requireAuth, async (req, res, next) => {
    try {
      res.json({
        emailSendingEnabled: !!cfg.emailSendingEnabled,
        siteUrlSet: !!cfg.siteUrl,
        storageDriver: storage.driver,
        localMode: !!cfg.useMemoryDb,
        subscribers: await data.subscribers.counts(),
      });
    } catch (e) { next(e); }
  });

  // ---- subscribers -------------------------------------------------------------------
  r.get("/subscribers", requireAuth, async (req, res, next) => {
    try {
      const perPage = Math.min(Math.max(parseInt(req.query.perPage, 10) || 25, 1), 100);
      const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
      const search = typeof req.query.q === "string" ? req.query.q.slice(0, 100) : "";
      const status = typeof req.query.status === "string" ? req.query.status : "";
      const out = await data.subscribers.list({ search, status, limit: perPage, offset: (page - 1) * perPage });
      res.json({ ...out, page, perPage, counts: await data.subscribers.counts() });
    } catch (e) { next(e); }
  });

  const csvCell = (v) => {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stop spreadsheet formula injection
    return `"${s.replace(/"/g, '""')}"`;
  };
  r.get("/subscribers.csv", requireAuth, async (req, res, next) => {
    try {
      const rows = await data.subscribers.all();
      const lines = [["Email", "Name", "Status", "Subscribed", "Unsubscribed"].map(csvCell).join(",")];
      rows.forEach((s) => lines.push([s.email, s.name, s.status, s.createdAt, s.unsubscribedAt].map(csvCell).join(",")));
      res.set("Content-Type", "text/csv; charset=utf-8");
      res.set("Content-Disposition", 'attachment; filename="subscribers.csv"');
      res.send("﻿" + lines.join("\r\n"));
    } catch (e) { next(e); }
  });

  r.post("/subscribers", requireAuth, async (req, res, next) => {
    try {
      const email = normalizeEmail(req.body && req.body.email);
      if (!email) throw bad("Enter a valid email address.");
      const result = await data.subscribers.subscribe({ email, name: str(req.body.name, 120), source: "admin" });
      res.status(result.created ? 201 : 200).json({ ok: true, created: result.created });
    } catch (e) { next(e); }
  });

  r.patch("/subscribers/:id", requireAuth, async (req, res, next) => {
    try {
      const status = req.body && req.body.status;
      if (!["active", "unsubscribed"].includes(status)) throw bad("Invalid status.");
      await data.subscribers.setStatus(Number(req.params.id), status);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  r.delete("/subscribers/:id", requireAuth, async (req, res, next) => {
    try { await data.subscribers.remove(Number(req.params.id)); res.json({ ok: true }); } catch (e) { next(e); }
  });

  // ---- files (uploaded to the bucket) ----------------------------------------------------
  r.get("/files", requireAuth, async (req, res, next) => {
    try { res.json({ files: await data.files.list(typeof req.query.kind === "string" ? req.query.kind : undefined) }); } catch (e) { next(e); }
  });

  r.post("/files", requireAuth, (req, res, next) => {
    upload(req, res, async (err) => {
      try {
        if (err) throw new HttpError(err.code === "LIMIT_FILE_SIZE" ? 413 : 400, err.code === "LIMIT_FILE_SIZE" ? "That file is too large (max 100 MB)." : "Upload failed.");
        if (!req.file) throw bad("Choose a file to upload.");
        const kind = req.body && req.body.kind === "image" ? "image" : "file";
        if (kind === "image" && req.file.size > MAX_IMAGE) throw new HttpError(413, "Images can be up to 8 MB.");
        const type = classifyUpload(kind, req.file.originalname, req.file.buffer);
        const put = await storage.put({
          folder: kind === "image" ? "images" : "downloads",
          originalName: req.file.originalname,
          buffer: req.file.buffer,
          contentType: type.mime,
        });
        const saved = await data.files.add({ kind, key: put.key, url: put.url, name: req.file.originalname.slice(0, 200), mime: type.mime, size: req.file.size });
        res.status(201).json({ file: saved });
      } catch (e) { next(e); }
    });
  });

  r.delete("/files/:id", requireAuth, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const f = await data.files.byId(id);
      if (!f) throw new HttpError(404, "File not found.");
      const banner = normalizeBanner(await data.settings.get("banner", {}));
      if (banner.items.some((i) => i.fileId === id)) throw new HttpError(409, "This file is used by the top banner. Change the banner first.");
      const blocks = await data.writings.list();
      if (blocks.some((b) => b.type === "image" && b.data.fileId === id)) throw new HttpError(409, "This image is used in Future Writings. Remove it there first.");
      if (downloadFileIds(await data.settings.get("downloads", {})).includes(id)) throw new HttpError(409, "This file is used on the Downloads page. Change it there first.");
      await storage.remove(f.key);
      await data.files.remove(id);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  // ---- top banner ------------------------------------------------------------------------------
  r.get("/banner", requireAuth, async (req, res, next) => {
    try { res.json({ banner: normalizeBanner(await data.settings.get("banner", {})) }); } catch (e) { next(e); }
  });

  r.put("/banner", requireAuth, async (req, res, next) => {
    try {
      const value = await validateBanner(req.body, (id) => data.files.byId(id));
      await data.settings.set("banner", value);
      res.json({ banner: value });
    } catch (e) { next(e); }
  });

  // ---- Downloads page (free sample books table) -----------------------------------------------
  r.get("/downloads", requireAuth, async (req, res, next) => {
    try { res.json({ downloads: normalizeDownloads(await data.settings.get("downloads", {})) }); } catch (e) { next(e); }
  });

  r.put("/downloads", requireAuth, async (req, res, next) => {
    try {
      const value = validateDownloads(req.body);
      await data.settings.set("downloads", value);
      res.json({ downloads: value });
    } catch (e) { next(e); }
  });

  // ---- My Writings blocks --------------------------------------------------------------------------
  r.get("/writings", requireAuth, async (req, res, next) => {
    try { res.json({ blocks: await data.writings.list() }); } catch (e) { next(e); }
  });

  r.post("/writings", requireAuth, async (req, res, next) => {
    try {
      const type = req.body && req.body.type;
      const clean = validateBlock(type, req.body.data);
      res.status(201).json({ block: await data.writings.add(type, clean) });
    } catch (e) { next(e); }
  });

  r.post("/writings/reorder", requireAuth, async (req, res, next) => {
    try {
      const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(Number) : [];
      const current = (await data.writings.list()).map((b) => b.id).sort((a, b) => a - b);
      if (ids.length !== current.length || [...ids].sort((a, b) => a - b).some((v, i) => v !== current[i])) throw bad("The order list does not match the blocks.");
      await data.writings.reorder(ids);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  r.put("/writings/:id", requireAuth, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const existing = await data.writings.byId(id);
      if (!existing) throw new HttpError(404, "Block not found.");
      const clean = validateBlock(existing.type, req.body && req.body.data);
      res.json({ block: await data.writings.update(id, clean) });
    } catch (e) { next(e); }
  });

  r.delete("/writings/:id", requireAuth, async (req, res, next) => {
    try { await data.writings.remove(Number(req.params.id)); res.json({ ok: true }); } catch (e) { next(e); }
  });

  // ---- email to subscribers ---------------------------------------------------------------------------
  const messageFields = (b) => ({
    subject: str(b && b.subject, 150, { required: true, name: "Subject" }),
    body: str(b && b.body, 20000, { required: true, name: "Message" }),
  });

  // Preview only: renders the email and counts recipients. Nothing is sent.
  r.post("/campaigns/preview", requireAuth, async (req, res, next) => {
    try { res.json(await campaigns.preview(messageFields(req.body))); } catch (e) { next(e); }
  });

  r.get("/campaigns", requireAuth, async (req, res, next) => {
    try { res.json({ campaigns: await data.campaigns.list(), sending: campaigns.isRunning() }); } catch (e) { next(e); }
  });

  r.get("/campaigns/:id", requireAuth, async (req, res, next) => {
    try {
      const c = await data.campaigns.byId(Number(req.params.id));
      if (!c) throw new HttpError(404, "Message not found.");
      res.json({ campaign: c, failures: await data.campaigns.failures(c.id) });
    } catch (e) { next(e); }
  });

  // Sending needs: the server switch on, and the admin typing SEND to confirm.
  const sendLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Too many send requests. Try again later." } });
  r.post("/campaigns/send", requireAuth, sendLimiter, async (req, res, next) => {
    try {
      const fields = messageFields(req.body);
      if ((req.body && req.body.confirm) !== "SEND") throw bad('Type SEND to confirm.');
      const campaign = await campaigns.create({ ...fields, createdBy: req.admin.username });
      campaigns.start(campaign.id);
      res.status(202).json({ campaign });
    } catch (e) { next(e); }
  });

  r.post("/campaigns/:id/resume", requireAuth, sendLimiter, async (req, res, next) => {
    try {
      if ((req.body && req.body.confirm) !== "SEND") throw bad('Type SEND to confirm.');
      await campaigns.resume(Number(req.params.id));
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  return r;
}

module.exports = { createAdminRouter };
