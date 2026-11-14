// File storage. Production: the S3-compatible bucket (Google Cloud Storage interoperability), public via the CDN URL.
// Local/test: files on disk. Every object lives under a folder dedicated to this website.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function safeName(name) {
  const base = path.basename(String(name || "file"));
  const cleaned = base.normalize("NFKD").replace(/[^\w.\-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+/, "");
  return (cleaned || "file").slice(-80);
}

function makeKey(prefix, folder, originalName) {
  const stamp = Date.now().toString(36);
  const rand = crypto.randomBytes(4).toString("hex");
  return [prefix, folder, `${stamp}-${rand}-${safeName(originalName)}`].filter(Boolean).join("/");
}

function createS3Storage(cfg) {
  const { S3Client, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
  const b = cfg.bucket;
  const endpoint = /^https?:\/\//.test(b.endpoint) ? b.endpoint : `https://${b.endpoint}`;
  const client = new S3Client({
    region: "auto",
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: b.key, secretAccessKey: b.secret },
    // Google Cloud Storage rejects the SDK's default checksum headers.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const publicBase = b.canonicalUrl || b.baseUrl;
  return {
    driver: "s3",
    publicUrl: (key) => `${publicBase}/${key}`,
    async put({ folder, originalName, buffer, contentType, cacheControl }) {
      const key = makeKey(cfg.storagePrefix, folder, originalName);
      await client.send(new PutObjectCommand({
        Bucket: b.name,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: cacheControl || "public, max-age=31536000, immutable",
        ACL: b.acl,
      }));
      return { key, url: `${publicBase}/${key}` };
    },
    // Upload to an exact key (used by the one-time site image upload script).
    async putAt({ key, buffer, contentType }) {
      if (!String(key).startsWith(cfg.storagePrefix + "/")) throw new Error("Refusing to write outside the website folder.");
      await client.send(new PutObjectCommand({
        Bucket: b.name, Key: key, Body: buffer, ContentType: contentType,
        CacheControl: "public, max-age=31536000", ACL: b.acl,
      }));
      return { key, url: `${publicBase}/${key}` };
    },
    async remove(key) {
      // Only ever delete objects inside this website's own folder.
      if (!String(key).startsWith(cfg.storagePrefix + "/")) return;
      await client.send(new DeleteObjectCommand({ Bucket: b.name, Key: key }));
    },
  };
}

function createLocalStorage(cfg) {
  const root = path.resolve(cfg.localUploadDir);
  return {
    driver: "local",
    root,
    publicUrl: (key) => `/uploads-dev/${key}`,
    async put({ folder, originalName, buffer }) {
      const key = makeKey(cfg.storagePrefix, folder, originalName);
      const full = path.join(root, key);
      await fs.promises.mkdir(path.dirname(full), { recursive: true });
      await fs.promises.writeFile(full, buffer);
      return { key, url: `/uploads-dev/${key}` };
    },
    async putAt({ key, buffer }) {
      const full = path.join(root, key);
      if (!full.startsWith(root + path.sep)) throw new Error("Bad key.");
      await fs.promises.mkdir(path.dirname(full), { recursive: true });
      await fs.promises.writeFile(full, buffer);
      return { key, url: `/uploads-dev/${key}` };
    },
    async remove(key) {
      const full = path.join(root, key);
      if (!full.startsWith(root + path.sep)) return;
      await fs.promises.unlink(full).catch(() => {});
    },
  };
}

function createStorage(cfg) {
  return cfg.storageDriver === "s3" ? createS3Storage(cfg) : createLocalStorage(cfg);
}

module.exports = { createStorage, makeKey, safeName };
