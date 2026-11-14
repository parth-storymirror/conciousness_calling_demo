// Central configuration. Values come from the environment (.env locally, real env vars in production).
// Nothing here prints or logs secret values.
require("dotenv").config({ quiet: true });

const env = process.env;
const bool = (v) => String(v || "").trim().toLowerCase() === "true";
const trimSlash = (v) => String(v || "").replace(/\/+$/, "");

function normalizePath(p) {
  let s = "/" + String(p || "").trim().replace(/^\/+|\/+$/g, "");
  if (s === "/") s = "/cc-admin";
  return s;
}

function load(overrides = {}) {
  const useMemoryDb = overrides.useMemoryDb ?? bool(env.USE_MEMORY_DB);
  const bucketConfigured = !!(env.BUCKET_KEY && env.BUCKET_SECRET && env.BUCKET_NAME && env.BUCKET_REGION_ENDPOINT);

  const cfg = {
    nodeEnv: env.NODE_ENV || "development",
    port: Number(env.PORT) || 3000,
    // The admin lives at a path that is not linked anywhere on the website.
    adminPath: normalizePath(overrides.adminPath ?? env.ADMIN_PATH ?? "/cc-admin"),
    siteUrl: trimSlash(overrides.siteUrl ?? env.PUBLIC_SITE_URL),
    sessionSecret: overrides.sessionSecret ?? env.SESSION_SECRET,
    sessionHours: Number(env.SESSION_HOURS) || 8,
    trustProxy: env.TRUST_PROXY || "",
    databaseUrl: env.DATABASE_URL,
    // Local-only mode: in-memory database, files on disk, and emails can never be sent.
    useMemoryDb,
    // Email sending is OFF unless this is explicitly "true", and is always off in memory/test mode.
    emailSendingEnabled: overrides.emailSendingEnabled ?? (bool(env.EMAIL_SENDING_ENABLED) && !useMemoryDb),
    mail: {
      key: env.ZEPTO_MAIL_KEY,
      apiUrl: env.ZEPTO_MAIL_API_URL || "https://api.zeptomail.com/v1.1/email",
      fromAddress: env.MAIL_FROM_ADDRESS,
      fromName: env.MAIL_FROM_NAME || "Consciousness Calling",
      replyTo: env.MAIL_REPLY_TO,
    },
    storageDriver: overrides.storageDriver ?? (useMemoryDb ? "local" : env.STORAGE_DRIVER || (bucketConfigured ? "s3" : "local")),
    storagePrefix: trimSlash(env.STORAGE_PREFIX || "raghuveera-website"),
    bucket: {
      endpoint: env.BUCKET_REGION_ENDPOINT,
      name: env.BUCKET_NAME,
      key: env.BUCKET_KEY,
      secret: env.BUCKET_SECRET,
      acl: env.BUCKET_DEFAULT_ACL || "public-read",
      canonicalUrl: trimSlash(env.BUCKET_CANONICAL_URL),
      baseUrl: trimSlash(env.BUCKET_ENDPOINT_BASE_URL),
    },
    // When "true", the server rewrites /assets/img/... in pages to the CDN copy (run the upload script first).
    siteImagesOnCdn: bool(env.SITE_IMAGES_ON_CDN),
    // Folder version for the site's own images (e.g. "v2"). Changing it makes browsers and the CDN fetch fresh copies.
    siteImagesVersion: String(env.SITE_IMAGES_VERSION || "").replace(/[^\w.-]/g, ""),
    localUploadDir: overrides.localUploadDir || "uploads-tmp",
  };
  return cfg;
}

module.exports = { load, normalizePath };
