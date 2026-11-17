// Public API used by the website. None of these routes send email.
const express = require("express");
const rateLimit = require("express-rate-limit");
const { normalizeEmail, str, HttpError, normalizeBanner, normalizeDownloads } = require("../validate");

function createPublicRouter({ data, cfg }) {
  const r = express.Router();
  const json = express.json({ limit: "4kb" });

  const subscribeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 12,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many attempts. Please try again later." },
  });

  // Follow Book Updates: stores the address. It does NOT send any email.
  r.post("/api/subscribe", subscribeLimiter, json, async (req, res, next) => {
    try {
      const body = req.body || {};
      // Hidden "hp_trap" field: real visitors leave it empty; bots fill it in. Pretend success and store nothing.
      if (typeof body.hp_trap === "string" && body.hp_trap.trim() !== "") return res.json({ ok: true });
      const email = normalizeEmail(body.email);
      if (!email) throw new HttpError(400, "Please enter a valid email address.");
      const name = str(body.name, 120, { name: "Name" });
      await data.subscribers.subscribe({ email, name, source: "website" });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  r.get("/api/banner", async (req, res, next) => {
    try {
      const b = normalizeBanner(await data.settings.get("banner", null));
      res.set("Cache-Control", "no-cache");
      if (!b.enabled || !b.items.length) return res.json({ enabled: false });
      const items = [];
      for (const it of b.items) {
        if (!it.text) continue;
        let link = null;
        if (it.linkType === "file") {
          const f = it.fileId ? await data.files.byId(it.fileId) : null;
          if (f) link = { label: it.linkLabel || "Download", url: f.url };
        } else if (it.linkType === "url" && it.linkUrl) {
          link = { label: it.linkLabel || "Open", url: it.linkUrl };
        }
        items.push({ text: it.text, link });
      }
      if (!items.length) return res.json({ enabled: false });
      res.json({ enabled: true, speed: b.speed, items });
    } catch (e) { next(e); }
  });

  r.get("/api/writings", async (req, res, next) => {
    try {
      res.set("Cache-Control", "no-cache");
      const blocks = await data.writings.list();
      res.json({ blocks: blocks.map((b) => ({ id: b.id, type: b.type, data: b.data })) });
    } catch (e) { next(e); }
  });

  r.get("/api/downloads", async (req, res, next) => {
    try {
      res.set("Cache-Control", "no-cache");
      res.json(normalizeDownloads(await data.settings.get("downloads", null)));
    } catch (e) { next(e); }
  });

  // Unsubscribe link from emails. GET shows a confirmation button (so mail scanners cannot unsubscribe people by prefetching).
  const page = (title, message, extra = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${title}</title><link rel="stylesheet" href="/css/style.css"></head><body><main id="main"><section class="block"><div class="wrap narrow center"><h1>${title}</h1><p>${message}</p>${extra}<p><a class="btn ghost" href="/index.html">Back to the website</a></p></div></section></main></body></html>`;
  const form = (token) => `<form method="post" action="/unsubscribe" style="margin:1.5em 0"><input type="hidden" name="token" value="${String(token).replace(/[^\w-]/g, "")}"><button class="btn" type="submit">Unsubscribe me</button></form>`;

  r.get("/unsubscribe", async (req, res, next) => {
    try {
      const token = typeof req.query.token === "string" ? req.query.token : "";
      const s = token ? await data.subscribers.byToken(token) : null;
      res.set("Cache-Control", "no-store");
      if (!s) return res.status(404).send(page("Link not found", "This unsubscribe link is not valid."));
      if (s.status !== "active") return res.send(page("Already unsubscribed", "You will not receive further updates."));
      res.send(page("Unsubscribe", "Confirm that you no longer want to receive emails from us.", form(token)));
    } catch (e) { next(e); }
  });

  r.post("/unsubscribe", express.urlencoded({ extended: false, limit: "2kb" }), async (req, res, next) => {
    try {
      const token = typeof req.body.token === "string" ? req.body.token : "";
      const s = token ? await data.subscribers.unsubscribeByToken(token) : null;
      res.set("Cache-Control", "no-store");
      if (!s) return res.status(404).send(page("Link not found", "This unsubscribe link is not valid."));
      res.send(page("You are unsubscribed", "You will not receive any further emails."));
    } catch (e) { next(e); }
  });

  return r;
}

module.exports = { createPublicRouter };
