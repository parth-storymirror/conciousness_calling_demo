// Input validation and sanitising helpers. All stored text is plain text; pages render it with textContent.
const path = require("node:path");

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (msg) => new HttpError(400, msg);

const str = (v, max, { required = false, name = "Field" } = {}) => {
  const s = typeof v === "string" ? v.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim() : "";
  if (required && !s) throw bad(`${name} is required.`);
  if (s.length > max) throw bad(`${name} is too long (max ${max} characters).`);
  return s;
};

function normalizeEmail(v) {
  const e = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (!e || e.length > 254 || !/^[^\s@<>"',;:()\[\]\\]+@[^\s@<>"',;:()\[\]\\]+\.[^\s@<>"',;:()\[\]\\]{2,}$/.test(e)) return null;
  return e;
}

// Links stored by the admin: http(s) only, so javascript: and data: URLs can never be saved.
function safeUrl(v, { allowRelative = false } = {}) {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return "";
  if (allowRelative && /^\/(?!\/)[\w\-./%]*$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.protocol === "https:" || u.protocol === "http:") return u.toString();
  } catch { /* fall through */ }
  throw bad("Enter a valid web address starting with https://");
}

// ---- writing blocks -----------------------------------------------------------
const BLOCK_TYPES = ["title", "text", "image", "table"];
const IMAGE_SIZES = ["small", "medium", "large"];

function validateBlock(type, data) {
  if (!BLOCK_TYPES.includes(type)) throw bad("Unknown block type.");
  const d = data && typeof data === "object" ? data : {};
  if (type === "title") {
    return { text: str(d.text, 200, { required: true, name: "Title" }), subtitle: str(d.subtitle, 200) };
  }
  if (type === "text") {
    return { text: str(d.text, 20000, { required: true, name: "Text" }) };
  }
  if (type === "image") {
    const url = safeUrl(d.url, { allowRelative: true });
    if (!url) throw bad("Upload an image first.");
    const size = IMAGE_SIZES.includes(d.size) ? d.size : "medium";
    return { url, alt: str(d.alt, 300), caption: str(d.caption, 300), size, fileId: Number.isInteger(d.fileId) ? d.fileId : null };
  }
  // table
  const headers = Array.isArray(d.headers) ? d.headers.slice(0, 8).map((h) => str(h, 120)) : [];
  const rows = Array.isArray(d.rows) ? d.rows.slice(0, 100).map((r) => (Array.isArray(r) ? r.slice(0, 8).map((c) => str(c, 1000)) : [])) : [];
  const cols = Math.max(headers.length, ...rows.map((r) => r.length), 0);
  if (cols < 1) throw bad("A table needs at least one column.");
  const pad = (arr) => Array.from({ length: cols }, (_, i) => arr[i] ?? "");
  return { title: str(d.title, 200), headers: pad(headers), rows: rows.map(pad), firstColumnBold: d.firstColumnBold !== false };
}

// ---- uploads ------------------------------------------------------------------
function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") return { mime: "image/png", ext: ".png" };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: ".jpg" };
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return { mime: "image/webp", ext: ".webp" };
  if (buf.toString("ascii", 0, 4) === "GIF8") return { mime: "image/gif", ext: ".gif" };
  return null;
}

const DOC_TYPES = {
  ".pdf": "application/pdf",
  ".epub": "application/epub+zip",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".zip": "application/zip",
  ".txt": "text/plain; charset=utf-8",
};

// Returns { mime, ext } for an allowed upload, or throws. "image" uploads must be real images.
function classifyUpload(kind, originalName, buffer) {
  if (!buffer || !buffer.length) throw bad("The file is empty.");
  const img = sniffImage(buffer);
  if (kind === "image") {
    if (!img) throw bad("Only PNG, JPG, WEBP or GIF images are allowed.");
    return img;
  }
  // "file" uploads (downloads): documents or images.
  if (img) return img;
  const ext = path.extname(String(originalName || "")).toLowerCase();
  if (!DOC_TYPES[ext]) throw bad("This file type is not allowed. Use PDF, EPUB, DOC(X), XLS(X), PPT(X), ZIP, TXT or an image.");
  if (ext === ".pdf" && buffer.toString("ascii", 0, 5) !== "%PDF-") throw bad("This file is not a valid PDF.");
  if ([".docx", ".xlsx", ".pptx", ".epub", ".zip"].includes(ext) && !(buffer[0] === 0x50 && buffer[1] === 0x4b)) throw bad("This file does not look like a valid " + ext.slice(1).toUpperCase() + ".");
  return { mime: DOC_TYPES[ext], ext };
}


// ---- top banner (several messages, each with its own optional link) -----------------------------
const BANNER_SPEEDS = ["slow", "normal", "fast"];

// Reads the stored banner. Older saves held a single message; those are converted on the fly.
function normalizeBanner(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const speed = BANNER_SPEEDS.includes(r.speed) ? r.speed : "normal";
  let items = Array.isArray(r.items) ? r.items : [];
  if (!Array.isArray(r.items) && r.text) {
    items = [{ text: r.text, linkType: r.fileId ? "file" : r.linkUrl ? "url" : "none", fileId: r.fileId || null, linkUrl: r.linkUrl || "", linkLabel: r.linkLabel || "" }];
  }
  return { enabled: !!r.enabled, speed, items: items.map((i) => ({
    text: String(i.text || ""), linkType: ["file", "url"].includes(i.linkType) ? i.linkType : "none",
    fileId: Number.isInteger(i.fileId) ? i.fileId : null, linkUrl: String(i.linkUrl || ""), linkLabel: String(i.linkLabel || ""),
  })) };
}

// Validates what the admin sends. `findFile(id)` must return the uploaded file or null.
async function validateBanner(body, findFile) {
  const b = body && typeof body === "object" ? body : {};
  const list = Array.isArray(b.items) ? b.items.slice(0, 10) : [];
  const items = [];
  for (let n = 0; n < list.length; n++) {
    const it = list[n] || {};
    const text = str(it.text, 300, { name: `Message ${n + 1}` }).replace(/\s*\n\s*/g, " ");
    if (!text) continue; // empty rows are dropped
    let linkType = ["file", "url"].includes(it.linkType) ? it.linkType : "none";
    let fileId = null;
    let linkUrl = "";
    if (linkType === "file") {
      const f = await findFile(Number(it.fileId));
      if (!f) throw bad(`Message ${n + 1}: choose an uploaded file, or set "No link".`);
      fileId = f.id;
    } else if (linkType === "url") {
      linkUrl = safeUrl(it.linkUrl);
      if (!linkUrl) throw bad(`Message ${n + 1}: enter the web address, or set "No link".`);
    }
    const linkLabel = linkType === "none" ? "" : str(it.linkLabel, 40) || (linkType === "file" ? "Download" : "Open");
    items.push({ text, linkType, fileId, linkUrl, linkLabel });
  }
  const enabled = !!b.enabled;
  if (enabled && !items.length) throw bad("Add at least one message before turning the banner on.");
  return { enabled, speed: BANNER_SPEEDS.includes(b.speed) ? b.speed : "normal", items };
}

// ---- Downloads page (one or more tables of downloadable items) ---------------------------------------
// Stored as { tables: [{ title, description, nameHeader, linkHeader, buttonLabel, rows: [{ name, url, fileId }] }] }.
// Normalizing on read (not just on write) means older/partial data never breaks the page; the first
// version stored a single table as { title, rows }, which is converted to one table here.
const DL_DEFAULTS = { nameHeader: "Book", linkHeader: "Free sample", buttonLabel: "Read free sample" };

function normalizeTable(t) {
  t = t && typeof t === "object" ? t : {};
  const rows = Array.isArray(t.rows) ? t.rows : [];
  const label = (v, d) => String(v || "").trim() || d;
  return {
    title: String(t.title || ""),
    description: String(t.description || ""),
    nameHeader: label(t.nameHeader, DL_DEFAULTS.nameHeader),
    linkHeader: label(t.linkHeader, DL_DEFAULTS.linkHeader),
    buttonLabel: label(t.buttonLabel, DL_DEFAULTS.buttonLabel),
    rows: rows.map((row) => ({
      name: String((row && row.name) || ""),
      url: String((row && row.url) || ""),
      fileId: row && Number.isInteger(row.fileId) ? row.fileId : null,
    })),
  };
}

function normalizeDownloads(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  if (Array.isArray(r.tables)) return { tables: r.tables.map(normalizeTable) };
  if (Array.isArray(r.rows) && (r.rows.length || r.title)) return { tables: [normalizeTable(r)] };
  return { tables: [] };
}

// Every uploaded file used by any table (so a file in use cannot be deleted).
function downloadFileIds(raw) {
  return normalizeDownloads(raw).tables.flatMap((t) => t.rows.map((r) => r.fileId)).filter((id) => id !== null);
}

// Validates what the admin sends.
function validateDownloads(body) {
  const b = body && typeof body === "object" ? body : {};
  const input = Array.isArray(b.tables) ? b.tables : (Array.isArray(b.rows) ? [b] : []);
  if (input.length > 20) throw bad("Too many tables (the limit is 20).");
  const tables = input.map((t, n) => {
    t = t && typeof t === "object" ? t : {};
    const rows = (Array.isArray(t.rows) ? t.rows : []).slice(0, 100).map((r) => {
      r = r && typeof r === "object" ? r : {};
      const name = str(r.name, 200);
      const url = r.url ? safeUrl(r.url, { allowRelative: true }) : "";
      if (r.url && !url) throw bad("A link is not a valid address.");
      return { name, url: url || "", fileId: Number.isInteger(r.fileId) ? r.fileId : null };
    }).filter((r) => r.name || r.url);
    if (rows.some((r) => !r.name)) throw bad(`Table ${n + 1}: every row needs a name.`);
    return {
      title: str(t.title, 200),
      description: str(t.description, 400),
      nameHeader: str(t.nameHeader, 60) || DL_DEFAULTS.nameHeader,
      linkHeader: str(t.linkHeader, 60) || DL_DEFAULTS.linkHeader,
      buttonLabel: str(t.buttonLabel, 60) || DL_DEFAULTS.buttonLabel,
      rows,
    };
  });
  return { tables };
}

module.exports = { normalizeBanner, validateBanner, normalizeDownloads, validateDownloads, downloadFileIds, HttpError, bad, str, normalizeEmail, safeUrl, validateBlock, BLOCK_TYPES, classifyUpload, sniffImage };
