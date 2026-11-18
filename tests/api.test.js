// Backend tests. They use an in-memory database, files in a temp folder, and a FAKE mail transport.
// No real database, bucket or email service is contacted, and no email can be sent.
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { build } = require("../server/index");
const { createFakeTransport } = require("../server/mailer");
const auth = require("../server/auth");

process.env.NODE_ENV = "test";

const ADMIN = "/test-admin-path";
const PASSWORD = "Correct-Horse-9";

async function start({ emailSendingEnabled = false } = {}) {
  const transport = createFakeTransport();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-test-"));
  const ctx = await build(
    { useMemoryDb: true, adminPath: ADMIN, siteUrl: "https://example.test", sessionSecret: "x".repeat(40), emailSendingEnabled, localUploadDir: dir },
    { transport, delayMs: 0 }
  );
  await ctx.data.admins.upsert("owner", auth.hashPassword(PASSWORD));
  const server = ctx.app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const close = () => new Promise((r) => server.close(r));
  return { ...ctx, transport, base, close, dir };
}

function client(base) {
  let cookie = "";
  let csrf = "";
  const call = async (method, url, body, extra = {}) => {
    const headers = { ...(extra.headers || {}) };
    if (cookie) headers.cookie = cookie;
    if (csrf && method !== "GET") headers["x-csrf-token"] = csrf;
    let payload = body;
    if (body && !(body instanceof FormData) && typeof body === "object") { payload = JSON.stringify(body); headers["content-type"] = "application/json"; }
    const res = await fetch(base + url, { method, headers, body: payload, redirect: "manual" });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  return {
    call,
    async login(username = "owner", password = PASSWORD) {
      const r = await call("POST", `${ADMIN}/api/login`, { username, password });
      if (r.json && r.json.csrf) csrf = r.json.csrf;
      return r;
    },
    admin: (m, u, b, e) => call(m, `${ADMIN}/api${u}`, b, e),
  };
}

test("public site: pages, admin not exposed, no secrets served", async () => {
  const s = await start();
  try {
    const c = client(s.base);
    assert.equal((await c.call("GET", "/")).status, 200);
    assert.equal((await c.call("GET", "/connect.html")).status, 200);
    assert.equal((await c.call("GET", "/css/style.css")).status, 200);
    // sensitive files must never be served
    for (const p of ["/.env", "/package.json", "/server/config.js", "/server/auth.js", "/review/brief-vs-demo.md", "/.git/config", "/admin/admin.js", "/node_modules/express/package.json", "/scripts/create-admin.js"]) {
      const r = await c.call("GET", p);
      assert.notEqual(r.status, 200, `${p} must not be served (got ${r.status})`);
      assert.ok(!/DATABASE_URL|scryptSync|module\.exports/.test(r.text), `${p} leaked source`);
    }
    // the admin page link must not appear anywhere on the public pages
    for (const p of ["/", "/connect.html", "/my-writing.html", "/index.html"]) {
      const html = (await c.call("GET", p)).text;
      assert.ok(!html.includes(ADMIN), `${p} must not link to the admin`);
    }
    const js = (await c.call("GET", "/js/site.js")).text;
    assert.ok(!js.includes("admin") || !js.includes(ADMIN));
  } finally { await s.close(); }
});

test("admin requires sign-in, hides behind noindex, and enforces CSRF", async () => {
  const s = await start();
  try {
    const c = client(s.base);
    const page = await c.call("GET", `${ADMIN}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("x-robots-tag"), /noindex/);
    for (const [m, u] of [["GET", "/subscribers"], ["GET", "/files"], ["GET", "/banner"], ["GET", "/downloads"], ["GET", "/writings"], ["GET", "/campaigns"], ["GET", "/status"], ["PUT", "/banner"], ["POST", "/campaigns/send"]]) {
      const r = await c.admin(m, u, m === "GET" ? undefined : {});
      assert.equal(r.status, 401, `${m} ${u} should need sign-in`);
    }
    assert.equal((await c.login("owner", "wrong-password-1")).status, 401);
    assert.equal((await c.login("nobody", PASSWORD)).status, 401);
    const ok = await c.login();
    assert.equal(ok.status, 200);
    assert.ok(ok.json.csrf);
    assert.equal((await c.admin("GET", "/me")).status, 200);
    // state change without CSRF token is rejected
    const noCsrf = await fetch(`${s.base}${ADMIN}/api/banner`, { method: "PUT", headers: { "content-type": "application/json", cookie: "cc_admin=" + (await (async () => { const r = await fetch(`${s.base}${ADMIN}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "owner", password: PASSWORD }) }); return r.headers.get("set-cookie").split(";")[0].split("=")[1]; })()) }, body: JSON.stringify({ text: "x" }) });
    assert.equal(noCsrf.status, 403);
  } finally { await s.close(); }
});

test("login locks an account after repeated failures", async () => {
  const s = await start();
  try {
    const c = client(s.base);
    for (let i = 0; i < 5; i++) assert.equal((await c.login("owner", "bad-password-" + i)).status, 401);
    assert.equal((await c.login()).status, 429, "correct password is refused while locked");
  } finally { await s.close(); }
});

test("subscribe stores addresses, dedupes, ignores bots, and sends NO email", async () => {
  const s = await start({ emailSendingEnabled: true });
  try {
    const c = client(s.base);
    assert.equal((await c.call("POST", "/api/subscribe", { email: "reader@example.com", name: "Reader" })).status, 200);
    assert.equal((await c.call("POST", "/api/subscribe", { email: "READER@example.com" })).status, 200); // duplicate, case-insensitive
    assert.equal((await c.call("POST", "/api/subscribe", { email: "not-an-email" })).status, 400);
    await c.call("POST", "/api/subscribe", { email: "bot@example.com", hp_trap: "http://spam" }); // honeypot
    const counts = await s.data.subscribers.counts();
    assert.equal(counts.total, 1);
    assert.equal(s.transport.sent.length, 0, "subscribing must never send mail");
    // list through the admin
    const a = client(s.base); await a.login();
    const list = await a.admin("GET", "/subscribers?q=reader");
    assert.equal(list.json.total, 1);
    assert.equal(list.json.rows[0].email, "reader@example.com");
  } finally { await s.close(); }
});

test("unsubscribe link needs confirmation and works", async () => {
  const s = await start();
  try {
    const c = client(s.base);
    await c.call("POST", "/api/subscribe", { email: "leave@example.com" });
    const row = (await s.data.subscribers.all())[0];
    const token = (await s.data.subscribers.activeWithTokens())[0].token;
    assert.equal((await c.call("GET", `/unsubscribe?token=${token}`)).status, 200);
    assert.equal((await s.data.subscribers.all())[0].status, "active", "GET must not unsubscribe");
    const post = await c.call("POST", "/unsubscribe", "token=" + token, { headers: { "content-type": "application/x-www-form-urlencoded" } });
    assert.equal(post.status, 200);
    assert.equal((await s.data.subscribers.all())[0].status, "unsubscribed");
    assert.equal((await c.call("GET", "/unsubscribe?token=bogus")).status, 404);
    assert.ok(row);
  } finally { await s.close(); }
});

test("subscriber admin: search, status, CSV (formula-safe), delete", async () => {
  const s = await start();
  try {
    const a = client(s.base); await a.login();
    await a.admin("POST", "/subscribers", { email: "one@example.com", name: "=cmd|' /C calc'!A0" });
    await a.admin("POST", "/subscribers", { email: "two@example.com" });
    const csv = await a.admin("GET", "/subscribers.csv");
    assert.match(csv.headers.get("content-type"), /text\/csv/);
    assert.ok(csv.text.includes(`"'=cmd`), "formula cells are neutralised");
    const list = await a.admin("GET", "/subscribers");
    const id = list.json.rows.find((r) => r.email === "one@example.com").id;
    assert.equal((await a.admin("PATCH", `/subscribers/${id}`, { status: "unsubscribed" })).status, 200);
    assert.equal((await a.admin("GET", "/subscribers?status=active")).json.total, 1);
    assert.equal((await a.admin("DELETE", `/subscribers/${id}`)).status, 200);
    assert.equal((await a.admin("GET", "/subscribers")).json.total, 1);
  } finally { await s.close(); }
});

test("email: preview never sends; send is blocked unless enabled; needs SEND; skips unsubscribed", async () => {
  // 1) sending switched OFF
  let s = await start({ emailSendingEnabled: false });
  try {
    const a = client(s.base); await a.login();
    await a.admin("POST", "/subscribers", { email: "a@example.com" });
    const pv = await a.admin("POST", "/campaigns/preview", { subject: "Hello", body: "Book is ready.\n\nSecond paragraph." });
    assert.equal(pv.status, 200);
    assert.equal(pv.json.recipients, 1);
    assert.equal(pv.json.canSend, false);
    assert.ok(pv.json.html.includes("Book is ready."));
    const blocked = await a.admin("POST", "/campaigns/send", { subject: "Hello", body: "Hi", confirm: "SEND" });
    assert.equal(blocked.status, 409);
    assert.equal(s.transport.sent.length, 0);
  } finally { await s.close(); }

  // 2) switched ON, using the FAKE transport only
  s = await start({ emailSendingEnabled: true });
  try {
    const a = client(s.base); await a.login();
    await a.admin("POST", "/subscribers", { email: "a@example.com", name: "A" });
    await a.admin("POST", "/subscribers", { email: "b@example.com" });
    await a.admin("POST", "/subscribers", { email: "gone@example.com" });
    const gone = (await a.admin("GET", "/subscribers?q=gone")).json.rows[0].id;
    await a.admin("PATCH", `/subscribers/${gone}`, { status: "unsubscribed" });
    assert.equal((await a.admin("POST", "/campaigns/send", { subject: "S", body: "B" })).status, 400, "missing SEND confirmation");
    assert.equal(s.transport.sent.length, 0);
    const send = await a.admin("POST", "/campaigns/send", { subject: "Book news", body: "It is here.\n<script>alert(1)</script>", confirm: "SEND" });
    assert.equal(send.status, 202);
    for (let i = 0; i < 50 && s.campaigns.isRunning(); i++) await new Promise((r) => setTimeout(r, 20));
    const done = await a.admin("GET", `/campaigns/${send.json.campaign.id}`);
    assert.equal(done.json.campaign.status, "completed");
    assert.equal(done.json.campaign.sent, 2);
    const to = s.transport.sent.map((m) => m.to).sort();
    assert.deepEqual(to, ["a@example.com", "b@example.com"], "unsubscribed address is never emailed");
    const msg = s.transport.sent[0];
    assert.ok(msg.html.includes("/unsubscribe?token="), "each email has an unsubscribe link");
    assert.ok(!msg.html.includes("<script>"), "message body is escaped");
    assert.ok(!/b@example.com/.test(s.transport.sent[0].html) && !/a@example.com/.test(s.transport.sent[1].html), "recipients never see each other");
  } finally { await s.close(); }
});

test("real email transport can never run in tests or local mode", async () => {
  const { createMailer, createZeptoTransport } = require("../server/mailer");
  const cfg = { emailSendingEnabled: true, useMemoryDb: false, mail: { key: "k", fromAddress: "x@example.com", apiUrl: "http://127.0.0.1:1" } };
  const mailer = createMailer(cfg, createZeptoTransport(cfg));
  await assert.rejects(() => mailer.sendOne({ to: "a@example.com", subject: "s", html: "h", text: "t" }), /blocked in tests/);
  const local = require("../server/config").load({ useMemoryDb: true });
  assert.equal(local.emailSendingEnabled, false, "memory mode forces sending off");
});

test("banner: several messages, each with its own link (file or web address)", async () => {
  const s = await start();
  try {
    const pub = client(s.base);
    assert.equal((await pub.call("GET", "/api/banner")).json.enabled, false);
    const a = client(s.base); await a.login();
    assert.equal((await a.admin("PUT", "/banner", { enabled: true, items: [{ text: "" }] })).status, 400, "needs a message to turn on");
    assert.equal((await a.admin("PUT", "/banner", { enabled: true, items: [{ text: "New", linkType: "url", linkUrl: "javascript:alert(1)" }] })).status, 400);
    assert.equal((await a.admin("PUT", "/banner", { enabled: true, items: [{ text: "New", linkType: "file", fileId: 999 }] })).status, 400, "unknown file");
    const fd = new FormData();
    fd.append("kind", "file");
    fd.append("file", new Blob([Buffer.from("%PDF-1.4\n%test\n")], { type: "application/pdf" }), "Chapter One.pdf");
    const up = await a.admin("POST", "/files", fd);
    assert.equal(up.status, 201);
    assert.match(up.json.file.url, /^\/uploads-dev\/raghuveera-website\/downloads\//);
    const put = await a.admin("PUT", "/banner", { enabled: true, speed: "slow", items: [
      { text: "Chapter one is out", linkType: "file", fileId: up.json.file.id, linkLabel: "Download PDF" },
      { text: "Read the interview", linkType: "url", linkUrl: "https://example.com/interview", linkLabel: "Read" },
      { text: "Just a note", linkType: "none" },
      { text: "   " },
    ] });
    assert.equal(put.status, 200);
    assert.equal(put.json.banner.items.length, 3, "empty rows are dropped");
    const view = (await pub.call("GET", "/api/banner")).json;
    assert.equal(view.enabled, true);
    assert.equal(view.speed, "slow");
    assert.equal(view.items.length, 3);
    assert.deepEqual(view.items[0], { text: "Chapter one is out", link: { label: "Download PDF", url: up.json.file.url } });
    assert.deepEqual(view.items[1], { text: "Read the interview", link: { label: "Read", url: "https://example.com/interview" } });
    assert.deepEqual(view.items[2], { text: "Just a note", link: null });
    assert.equal((await a.admin("DELETE", `/files/${up.json.file.id}`)).status, 409, "file used by a message cannot be deleted");
    await a.admin("PUT", "/banner", { enabled: false, items: [{ text: "Read the interview", linkType: "url", linkUrl: "https://example.com/interview" }] });
    assert.equal((await a.admin("DELETE", `/files/${up.json.file.id}`)).status, 200);
    assert.equal((await pub.call("GET", "/api/banner")).json.enabled, false);
  } finally { await s.close(); }
});

test("banner: an older single-message save is shown and converted", async () => {
  const s = await start();
  try {
    await s.data.settings.set("banner", { enabled: true, text: "Old style message", speed: "fast", linkLabel: "Go", fileId: null, linkUrl: "https://example.com/old" });
    const pub = client(s.base);
    const view = (await pub.call("GET", "/api/banner")).json;
    assert.equal(view.enabled, true);
    assert.deepEqual(view.items, [{ text: "Old style message", link: { label: "Go", url: "https://example.com/old" } }]);
    const a = client(s.base); await a.login();
    const admin = (await a.admin("GET", "/banner")).json.banner;
    assert.equal(admin.items.length, 1);
    assert.equal(admin.items[0].linkType, "url");
  } finally { await s.close(); }
});

test("downloads: several tables with their own headings, columns and button text", async () => {
  const s = await start();
  try {
    const pub = client(s.base);
    assert.deepEqual((await pub.call("GET", "/api/downloads")).json, { tables: [] }, "empty by default");
    const a = client(s.base); await a.login();
    assert.equal((await pub.call("GET", `${ADMIN}/api/downloads`)).status, 401, "unauthenticated reads are refused");
    assert.equal((await a.admin("PUT", "/downloads", { tables: [{ rows: [{ name: "", url: "https://example.com/x.pdf" }] }] })).status, 400, "every row needs a name");
    assert.equal((await a.admin("PUT", "/downloads", { tables: [{ rows: [{ name: "X", url: "javascript:alert(1)" }] }] })).status, 400);
    const put = await a.admin("PUT", "/downloads", { tables: [
      { title: "Free Sample Books", rows: [{ name: "Book A", url: "https://example.com/a.pdf" }, { name: "", url: "" }] },
      { title: "Guides", nameHeader: "Guide", linkHeader: "PDF", buttonLabel: "Download", rows: [{ name: "Guide 1", url: "https://example.com/g.pdf" }] },
    ] });
    assert.equal(put.status, 200);
    assert.equal(put.json.downloads.tables[0].rows.length, 1, "empty rows are dropped");
    const view = (await pub.call("GET", "/api/downloads")).json;
    assert.deepEqual(view.tables[0], { title: "Free Sample Books", nameHeader: "Book", linkHeader: "Free sample", buttonLabel: "Read free sample", rows: [{ name: "Book A", url: "https://example.com/a.pdf", fileId: null }] }, "blank labels fall back to the defaults");
    assert.deepEqual(view.tables[1], { title: "Guides", nameHeader: "Guide", linkHeader: "PDF", buttonLabel: "Download", rows: [{ name: "Guide 1", url: "https://example.com/g.pdf", fileId: null }] });
    // data saved by the first version (one table as { title, rows }) still shows up
    await s.data.settings.set("downloads", { title: "My Resources", rows: [{ name: "Old", url: "https://example.com/o.pdf" }] });
    const legacy = (await pub.call("GET", "/api/downloads")).json;
    assert.equal(legacy.tables.length, 1);
    assert.equal(legacy.tables[0].title, "My Resources");
    assert.equal(legacy.tables[0].buttonLabel, "Read free sample");
  } finally { await s.close(); }
});

test("uploads: type checks, image sniffing, size limits", async () => {
  const s = await start();
  try {
    const a = client(s.base); await a.login();
    const up = (kind, name, bytes) => { const fd = new FormData(); fd.append("kind", kind); fd.append("file", new Blob([bytes]), name); return a.admin("POST", "/files", fd); };
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    assert.equal((await up("image", "pic.png", Buffer.concat([png, Buffer.alloc(32)]))).status, 201);
    assert.equal((await up("image", "evil.png", Buffer.from("<script>alert(1)</script>"))).status, 400);
    assert.equal((await up("image", "vector.svg", Buffer.from("<svg onload=alert(1)></svg>"))).status, 400);
    assert.equal((await up("file", "run.exe", Buffer.from("MZ......"))).status, 400);
    assert.equal((await up("file", "fake.pdf", Buffer.from("not a pdf"))).status, 400);
    assert.equal((await up("file", "ok.pdf", Buffer.from("%PDF-1.7 hello"))).status, 201);
    assert.equal((await a.admin("POST", "/files", new FormData())).status, 400);
  } finally { await s.close(); }
});

test("My Writings: defaults, add/edit/reorder/delete blocks, table editing, validation", async () => {
  const s = await start();
  try {
    const pub = client(s.base);
    const initial = (await pub.call("GET", "/api/writings")).json.blocks;
    assert.ok(initial.length >= 5, "starts with the content already on the page");
    assert.ok(initial.some((b) => b.type === "table"));
    const a = client(s.base); await a.login();
    // unauthenticated edits are refused
    assert.equal((await pub.call("POST", `${ADMIN}/api/writings`, { type: "text", data: { text: "x" } })).status, 401);
    const title = await a.admin("POST", "/writings", { type: "title", data: { text: "New title", subtitle: "Sub" } });
    assert.equal(title.status, 201);
    const text = await a.admin("POST", "/writings", { type: "text", data: { text: "Para one\n\nPara two" } });
    const table = await a.admin("POST", "/writings", { type: "table", data: { title: "T", headers: ["A", "B"], rows: [["1", "2"], ["3"]] } });
    assert.deepEqual(table.json.block.data.rows[1], ["3", ""], "short rows are padded");
    assert.equal((await a.admin("POST", "/writings", { type: "samples", data: { rows: [{ name: "X" }] } })).status, 400, "samples is no longer a My Writings block type");
    assert.equal((await a.admin("POST", "/writings", { type: "script", data: {} })).status, 400);
    assert.equal((await a.admin("POST", "/writings", { type: "text", data: { text: "   " } })).status, 400);
    assert.equal((await a.admin("POST", "/writings", { type: "image", data: { url: "javascript:alert(1)" } })).status, 400);
    const upd = await a.admin("PUT", `/writings/${text.json.block.id}`, { data: { text: "Edited" } });
    assert.equal(upd.json.block.data.text, "Edited");
    const ids = (await a.admin("GET", "/writings")).json.blocks.map((b) => b.id).reverse();
    assert.equal((await a.admin("POST", "/writings/reorder", { ids })).status, 200);
    assert.equal((await a.admin("GET", "/writings")).json.blocks[0].id, ids[0]);
    assert.equal((await a.admin("POST", "/writings/reorder", { ids: [1, 2] })).status, 400);
    assert.equal((await a.admin("DELETE", `/writings/${title.json.block.id}`)).status, 200);
    const pubBlocks = (await pub.call("GET", "/api/writings")).json.blocks;
    assert.ok(!pubBlocks.some((b) => b.id === title.json.block.id));
  } finally { await s.close(); }
});

test("password change enforces rules", async () => {
  const s = await start();
  try {
    const a = client(s.base); await a.login();
    assert.equal((await a.admin("POST", "/password", { current: "wrong", next: "Another-Pass-77" })).status, 400);
    assert.equal((await a.admin("POST", "/password", { current: PASSWORD, next: "short" })).status, 400);
    assert.equal((await a.admin("POST", "/password", { current: PASSWORD, next: "Another-Pass-77" })).status, 200);
    const b = client(s.base);
    assert.equal((await b.login("owner", PASSWORD)).status, 401);
    assert.equal((await b.login("owner", "Another-Pass-77")).status, 200);
  } finally { await s.close(); }
});

test("rate limiting protects the subscribe form", async () => {
  const s = await start();
  try {
    const c = client(s.base);
    let limited = false;
    for (let i = 0; i < 20; i++) {
      const r = await c.call("POST", "/api/subscribe", { email: `user${i}@example.com` });
      if (r.status === 429) { limited = true; break; }
    }
    assert.ok(limited, "too many sign-ups from one address are throttled");
  } finally { await s.close(); }
});

test("search engines: public pages are indexable, the admin is not, and it is never advertised", async () => {
  const s = await start();
  try {
    const robots = await fetch(`${s.base}/robots.txt`);
    assert.equal(robots.status, 200);
    const robotsText = await robots.text();
    assert.match(robotsText, /Sitemap: .*\/sitemap\.xml/);
    assert.ok(!robotsText.includes(ADMIN), "robots.txt must not reveal the hidden admin path");
    const map = await (await fetch(`${s.base}/sitemap.xml`)).text();
    assert.match(map, /<urlset/);
    assert.ok(map.includes("/downloads.html") && map.includes("/faqs.html"));
    assert.ok(!map.includes(ADMIN), "the sitemap must not list the admin");
    for (const page of ["/index.html", "/about.html", "/downloads.html", "/faqs.html"]) {
      const html = await (await fetch(`${s.base}${page}`)).text();
      assert.ok(!/name="robots"[^>]*noindex/i.test(html), `${page} must not be marked noindex`);
    }
    const adminRes = await fetch(`${s.base}${ADMIN}/`);
    assert.match(adminRes.headers.get("x-robots-tag") || "", /noindex/, "admin is kept out of search");
  } finally { await s.close(); }
});

test("/index.html redirects permanently to the home page at /", async () => {
  const s = await start();
  try {
    const res = await fetch(`${s.base}/index.html`, { redirect: "manual" });
    assert.equal(res.status, 301);
    assert.equal(res.headers.get("location"), "/");
    assert.equal((await fetch(`${s.base}/`)).status, 200);
  } finally { await s.close(); }
});
