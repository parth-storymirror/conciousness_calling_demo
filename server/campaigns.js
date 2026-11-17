// Sending a message to subscribers.
//
// Nothing here runs on its own: a campaign is only created when an admin explicitly confirms,
// and sending requires EMAIL_SENDING_ENABLED=true (see mailer.js). Messages go out one at a time so
// recipients never see each other, each with its own unsubscribe link.
const { renderEmail } = require("./mailer");
const { HttpError } = require("./validate");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createCampaignService({ data, mailer, cfg, delayMs = 250 }) {
  let running = false;

  const unsubscribeUrl = (token) => `${cfg.siteUrl}/unsubscribe?token=${encodeURIComponent(token)}`;
  const logoUrl = () => (cfg.bucket.canonicalUrl ? `${cfg.bucket.canonicalUrl}/${cfg.storagePrefix}/site/${cfg.siteImagesVersion ? cfg.siteImagesVersion + "/" : ""}img-02-emblem-transparent.png` : (cfg.siteUrl ? `${cfg.siteUrl}/assets/img/img-02-emblem-transparent.png` : ""));
  const brand = () => cfg.mail.fromName || "Consciousness Calling";

  function assertCanSend() {
    if (!mailer.enabled()) throw new HttpError(409, "Email sending is turned off on this server. Set EMAIL_SENDING_ENABLED=true to allow it.");
    if (!mailer.configured()) throw new HttpError(409, "Email is not configured (ZEPTO_MAIL_KEY and MAIL_FROM_ADDRESS are required).");
    if (!cfg.siteUrl) throw new HttpError(409, "PUBLIC_SITE_URL is not set, so unsubscribe links cannot be created.");
  }

  async function preview({ subject, body }) {
    const counts = await data.subscribers.counts();
    const rendered = renderEmail({ subject, body, unsubscribeUrl: `${cfg.siteUrl || "https://example.invalid"}/unsubscribe?token=PREVIEW`, brand: brand(), logoUrl: logoUrl() });
    return { recipients: counts.active, html: rendered.html, logoUrl: logoUrl(), canSend: mailer.enabled() && mailer.configured() && !!cfg.siteUrl };
  }

  async function create({ subject, body, createdBy }) {
    assertCanSend();
    if (await data.campaigns.active()) throw new HttpError(409, "A message is already being sent. Wait for it to finish.");
    const recipients = (await data.subscribers.activeWithTokens()).map((r) => ({ id: r.id, email: r.email }));
    if (!recipients.length) throw new HttpError(400, "There are no active subscribers to send to.");
    return data.campaigns.create({ subject, body, createdBy, recipients });
  }

  async function run(id) {
    const campaign = await data.campaigns.byId(id);
    await data.campaigns.setStatus(id, "sending");
    let consecutiveFailures = 0;
    try {
      for (;;) {
        const batch = await data.campaigns.pendingRecipients(id, 25);
        if (!batch.length) break;
        for (const r of batch) {
          if (r.sub_status !== "active") {
            await data.campaigns.markRecipient(r.id, "skipped", "Unsubscribed before sending");
            continue;
          }
          try {
            const { html, text } = renderEmail({ subject: campaign.subject, body: campaign.body, unsubscribeUrl: unsubscribeUrl(r.token), brand: brand(), logoUrl: logoUrl() });
            await mailer.sendOne({ to: r.email, toName: r.name || r.email, subject: campaign.subject, html, text });
            await data.campaigns.markRecipient(r.id, "sent");
            consecutiveFailures = 0;
          } catch (e) {
            await data.campaigns.markRecipient(r.id, "failed", String(e.message || e).slice(0, 300));
            consecutiveFailures++;
          }
          if (consecutiveFailures >= 5) throw new Error("Stopped after 5 failures in a row.");
          if (delayMs) await sleep(delayMs);
        }
        await data.campaigns.refreshCounts(id);
      }
      const { failed } = await data.campaigns.refreshCounts(id);
      await data.campaigns.finish(id, failed ? "completed_with_errors" : "completed");
    } catch (e) {
      await data.campaigns.refreshCounts(id);
      await data.campaigns.finish(id, "stopped");
    }
  }

  // Starts sending in the background and returns immediately.
  function start(id) {
    if (running) return false;
    running = true;
    run(id).catch(() => {}).finally(() => { running = false; });
    return true;
  }

  async function resume(id) {
    assertCanSend();
    const c = await data.campaigns.byId(id);
    if (!c) throw new HttpError(404, "Message not found.");
    if (!["stopped", "interrupted"].includes(c.status)) throw new HttpError(409, "Only a stopped message can be resumed.");
    if (await data.campaigns.active()) throw new HttpError(409, "A message is already being sent.");
    await data.campaigns.setStatus(id, "queued");
    return start(id);
  }

  return { preview, create, start, resume, assertCanSend, isRunning: () => running };
}

module.exports = { createCampaignService };
