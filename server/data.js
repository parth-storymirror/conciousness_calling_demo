// Database queries. Plain SQL with parameters only (no string-built SQL).
const crypto = require("node:crypto");

const iso = (d) => (d ? new Date(d).toISOString() : null);

function createData(db) {
  const q = (text, params) => db.query(text, params);
  const one = async (text, params) => (await q(text, params)).rows[0] || null;

  // ---- admins --------------------------------------------------------------
  const admins = {
    byUsername: (u) => one("SELECT id, username, password_hash FROM admins WHERE username = $1", [u]),
    byId: (id) => one("SELECT id, username, password_hash FROM admins WHERE id = $1", [id]),
    async upsert(username, hash) {
      const existing = await admins.byUsername(username);
      if (existing) {
        await q("UPDATE admins SET password_hash = $1 WHERE id = $2", [hash, existing.id]);
        return existing.id;
      }
      return (await q("INSERT INTO admins (username, password_hash) VALUES ($1, $2) RETURNING id", [username, hash])).rows[0].id;
    },
    setPassword: (id, hash) => q("UPDATE admins SET password_hash = $1 WHERE id = $2", [hash, id]),
    count: async () => Number((await one("SELECT COUNT(*) AS n FROM admins")).n),
  };

  // ---- subscribers ---------------------------------------------------------
  const shapeSub = (r) => ({
    id: r.id, email: r.email, name: r.name || "", status: r.status, source: r.source || "",
    createdAt: iso(r.created_at), unsubscribedAt: iso(r.unsubscribed_at),
  });

  const subscribers = {
    // Returns { created: boolean } and never reveals whether an address already existed to the public caller.
    async subscribe({ email, name, source }) {
      const existing = await one("SELECT id, status FROM subscribers WHERE email = $1", [email]);
      if (existing) {
        if (existing.status !== "active") {
          await q("UPDATE subscribers SET status = 'active', unsubscribed_at = NULL, name = $1 WHERE id = $2", [name || null, existing.id]);
        }
        return { created: false, id: existing.id };
      }
      const token = crypto.randomBytes(24).toString("base64url");
      const r = await q(
        "INSERT INTO subscribers (email, name, status, token, source) VALUES ($1, $2, 'active', $3, $4) RETURNING id",
        [email, name || null, token, source || "website"]
      );
      return { created: true, id: r.rows[0].id };
    },
    async list({ search = "", status = "", limit = 50, offset = 0 }) {
      const where = [];
      const params = [];
      if (status === "active" || status === "unsubscribed") { params.push(status); where.push(`status = $${params.length}`); }
      if (search) { params.push(`%${search.toLowerCase()}%`); where.push(`(LOWER(email) LIKE $${params.length} OR LOWER(COALESCE(name, '')) LIKE $${params.length})`); }
      const w = where.length ? "WHERE " + where.join(" AND ") : "";
      const total = Number((await one(`SELECT COUNT(*) AS n FROM subscribers ${w}`, params)).n);
      const rows = (await q(`SELECT id, email, name, status, source, created_at, unsubscribed_at FROM subscribers ${w} ORDER BY id DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`, params)).rows;
      return { total, rows: rows.map(shapeSub) };
    },
    async all() {
      return (await q("SELECT id, email, name, status, source, created_at, unsubscribed_at FROM subscribers ORDER BY id ASC")).rows.map(shapeSub);
    },
    async counts() {
      const rows = (await q("SELECT status, COUNT(*) AS n FROM subscribers GROUP BY status")).rows;
      const out = { active: 0, unsubscribed: 0, total: 0 };
      rows.forEach((r) => { out[r.status] = Number(r.n); out.total += Number(r.n); });
      return out;
    },
    byToken: (t) => one("SELECT id, email, name, status FROM subscribers WHERE token = $1", [t]),
    async unsubscribeByToken(t) {
      const s = await subscribers.byToken(t);
      if (!s) return null;
      if (s.status === "active") await q("UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = now() WHERE id = $1", [s.id]);
      return s;
    },
    async setStatus(id, status) {
      if (status === "active") await q("UPDATE subscribers SET status = 'active', unsubscribed_at = NULL WHERE id = $1", [id]);
      else await q("UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = now() WHERE id = $1", [id]);
    },
    remove: (id) => q("DELETE FROM subscribers WHERE id = $1", [id]),
    async activeWithTokens() {
      return (await q("SELECT id, email, name, token FROM subscribers WHERE status = 'active' ORDER BY id ASC")).rows;
    },
  };

  // ---- settings (JSON values) ----------------------------------------------
  const settings = {
    async get(key, fallback) {
      const r = await one("SELECT value FROM site_settings WHERE key = $1", [key]);
      if (!r) return fallback;
      try { return JSON.parse(r.value); } catch { return fallback; }
    },
    async set(key, value) {
      const v = JSON.stringify(value);
      const r = await one("SELECT key FROM site_settings WHERE key = $1", [key]);
      if (r) await q("UPDATE site_settings SET value = $1, updated_at = now() WHERE key = $2", [v, key]);
      else await q("INSERT INTO site_settings (key, value) VALUES ($1, $2)", [key, v]);
    },
  };

  // ---- uploaded files --------------------------------------------------------
  const shapeFile = (r) => ({ id: r.id, kind: r.kind, key: r.storage_key, url: r.url, name: r.original_name, mime: r.mime, size: r.size, createdAt: iso(r.created_at) });
  const files = {
    async add({ kind, key, url, name, mime, size }) {
      const r = await q("INSERT INTO uploaded_files (kind, storage_key, url, original_name, mime, size) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [kind, key, url, name, mime, size]);
      return files.byId(r.rows[0].id);
    },
    async byId(id) { const r = await one("SELECT * FROM uploaded_files WHERE id = $1", [id]); return r ? shapeFile(r) : null; },
    async list(kind) {
      const rows = kind
        ? (await q("SELECT * FROM uploaded_files WHERE kind = $1 ORDER BY id DESC", [kind])).rows
        : (await q("SELECT * FROM uploaded_files ORDER BY id DESC")).rows;
      return rows.map(shapeFile);
    },
    remove: (id) => q("DELETE FROM uploaded_files WHERE id = $1", [id]),
  };

  // ---- writing blocks ----------------------------------------------------------
  const shapeBlock = (r) => {
    let data = {};
    try { data = JSON.parse(r.data); } catch { /* keep empty */ }
    return { id: r.id, position: r.position, type: r.type, data };
  };
  const writings = {
    async list() { return (await q("SELECT id, position, type, data FROM writing_blocks ORDER BY position ASC, id ASC")).rows.map(shapeBlock); },
    async count() { return Number((await one("SELECT COUNT(*) AS n FROM writing_blocks")).n); },
    async byId(id) { const r = await one("SELECT id, position, type, data FROM writing_blocks WHERE id = $1", [id]); return r ? shapeBlock(r) : null; },
    async add(type, data, position) {
      let pos = position;
      if (!Number.isInteger(pos)) {
        const m = await one("SELECT MAX(position) AS m FROM writing_blocks");
        pos = (m && m.m !== null ? Number(m.m) : 0) + 1;
      }
      const r = await q("INSERT INTO writing_blocks (position, type, data) VALUES ($1,$2,$3) RETURNING id", [pos, type, JSON.stringify(data)]);
      return writings.byId(r.rows[0].id);
    },
    async update(id, data) {
      await q("UPDATE writing_blocks SET data = $1, updated_at = now() WHERE id = $2", [JSON.stringify(data), id]);
      return writings.byId(id);
    },
    remove: (id) => q("DELETE FROM writing_blocks WHERE id = $1", [id]),
    async reorder(ids) {
      for (let i = 0; i < ids.length; i++) await q("UPDATE writing_blocks SET position = $1 WHERE id = $2", [i + 1, ids[i]]);
    },
  };

  // ---- campaigns ----------------------------------------------------------------
  const shapeCampaign = (r) => ({
    id: r.id, subject: r.subject, body: r.body, status: r.status, total: r.total, sent: r.sent, failed: r.failed,
    createdBy: r.created_by || "", createdAt: iso(r.created_at), finishedAt: iso(r.finished_at),
  });
  const campaigns = {
    async create({ subject, body, createdBy, recipients }) {
      const c = await q("INSERT INTO campaigns (subject, body, status, total, created_by) VALUES ($1,$2,'queued',$3,$4) RETURNING id", [subject, body, recipients.length, createdBy]);
      const id = c.rows[0].id;
      for (const r of recipients) {
        await q("INSERT INTO campaign_recipients (campaign_id, subscriber_id, email) VALUES ($1,$2,$3)", [id, r.id, r.email]);
      }
      return campaigns.byId(id);
    },
    async byId(id) { const r = await one("SELECT * FROM campaigns WHERE id = $1", [id]); return r ? shapeCampaign(r) : null; },
    async list() { return (await q("SELECT * FROM campaigns ORDER BY id DESC LIMIT 50")).rows.map(shapeCampaign); },
    async active() { const r = await one("SELECT * FROM campaigns WHERE status IN ('queued','sending') ORDER BY id DESC LIMIT 1"); return r ? shapeCampaign(r) : null; },
    setStatus: (id, status) => q("UPDATE campaigns SET status = $1 WHERE id = $2", [status, id]),
    async finish(id, status) {
      await q("UPDATE campaigns SET status = $1, finished_at = now() WHERE id = $2", [status, id]);
    },
    async refreshCounts(id) {
      const sent = Number((await one("SELECT COUNT(*) AS n FROM campaign_recipients WHERE campaign_id = $1 AND status = 'sent'", [id])).n);
      const failed = Number((await one("SELECT COUNT(*) AS n FROM campaign_recipients WHERE campaign_id = $1 AND status = 'failed'", [id])).n);
      await q("UPDATE campaigns SET sent = $1, failed = $2 WHERE id = $3", [sent, failed, id]);
      return { sent, failed };
    },
    async pendingRecipients(id, limit = 50) {
      return (await q(
        `SELECT cr.id, cr.email, s.name, s.token, s.status AS sub_status
           FROM campaign_recipients cr JOIN subscribers s ON s.id = cr.subscriber_id
          WHERE cr.campaign_id = $1 AND cr.status = 'pending' ORDER BY cr.id ASC LIMIT ${Number(limit)}`, [id])).rows;
    },
    markRecipient: (rid, status, error) => q("UPDATE campaign_recipients SET status = $1, error = $2, sent_at = now() WHERE id = $3", [status, error || null, rid]),
    async failures(id) { return (await q("SELECT email, error FROM campaign_recipients WHERE campaign_id = $1 AND status = 'failed' ORDER BY id ASC LIMIT 200", [id])).rows; },
    async markInterrupted() {
      await q("UPDATE campaigns SET status = 'interrupted' WHERE status IN ('queued','sending')");
    },
  };

  return { admins, subscribers, settings, files, writings, campaigns };
}

module.exports = { createData };
