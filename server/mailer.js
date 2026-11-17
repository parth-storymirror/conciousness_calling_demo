// Email delivery through ZeptoMail.
//
// SAFETY: this module only sends when ALL of these hold:
//   - EMAIL_SENDING_ENABLED=true is set on the server,
//   - the server is not in local/test memory mode,
//   - a transport is available (the real transport needs ZEPTO_MAIL_KEY and a sender address).
// Tests and local runs use a fake transport and can never reach ZeptoMail.

function normalizeKey(key) {
  const k = String(key || "").trim();
  if (!k) return "";
  return /^zoho-enczapikey/i.test(k) ? k : `Zoho-enczapikey ${k}`;
}

function createZeptoTransport(cfg) {
  return {
    name: "zeptomail",
    async send({ to, toName, subject, html, text }) {
      const m = cfg.mail;
      if (!m.key || !m.fromAddress) throw new Error("Mail is not configured (ZEPTO_MAIL_KEY / MAIL_FROM_ADDRESS).");
      const payload = {
        from: { address: m.fromAddress, name: m.fromName },
        to: [{ email_address: { address: to, name: toName || to } }],
        subject,
        htmlbody: html,
        textbody: text,
      };
      if (m.replyTo) payload.reply_to = [{ address: m.replyTo, name: m.fromName }];
      const res = await fetch(m.apiUrl, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: normalizeKey(m.key) },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 300);
        throw new Error(`ZeptoMail ${res.status}: ${detail}`);
      }
    },
  };
}

// Records messages instead of sending them. Used by local mode and tests.
function createFakeTransport() {
  const sent = [];
  return { name: "fake", sent, async send(msg) { sent.push(msg); } };
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function renderEmail({ subject, body, unsubscribeUrl, brand, logoUrl }) {
  const logo = logoUrl ? `<img src="${esc(logoUrl)}" alt="${esc(brand)}" width="64" height="64" style="display:block;margin:0 auto 18px;border:0">` : "";
  const paragraphs = String(body).trim().split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#fffaf0;font-family:Arial,Helvetica,sans-serif;color:#2a2540;line-height:1.6">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #ecdcb8;border-radius:10px;padding:28px">
${logo}<h2 style="margin:0 0 18px;font-family:Georgia,serif;color:#1c1740">${esc(subject)}</h2>
${paragraphs}
<hr style="border:none;border-top:1px solid #ecdcb8;margin:24px 0 12px">
<p style="margin:0;font-size:12px;color:#6b6585">You are receiving this because you subscribed. <a href="${esc(unsubscribeUrl)}" style="color:#8f5e0a">Unsubscribe</a></p>
</div></body></html>`;
  const text = `${subject}\n\n${String(body).trim()}\n\n--\nYou are receiving this because you subscribed.\nUnsubscribe: ${unsubscribeUrl}`;
  return { html, text };
}

function createMailer(cfg, transportOverride) {
  const transport = transportOverride || (cfg.useMemoryDb ? createFakeTransport() : createZeptoTransport(cfg));
  return {
    transport,
    enabled: () => !!cfg.emailSendingEnabled,
    configured: () => (transport.name === "fake" ? true : !!(cfg.mail.key && cfg.mail.fromAddress)),
    async sendOne(msg) {
      if (!cfg.emailSendingEnabled) throw new Error("Email sending is disabled on this server.");
      if (process.env.NODE_ENV === "test" && transport.name !== "fake") throw new Error("Real email transport is blocked in tests.");
      return transport.send(msg);
    },
  };
}

module.exports = { createMailer, createFakeTransport, createZeptoTransport, renderEmail, normalizeKey };
