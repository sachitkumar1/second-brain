// Prints fresh random values for the secret environment variables.
// Usage: node scripts/generate-secrets.mjs
import { randomBytes } from "node:crypto";
import webpush from "web-push";

const b64 = (n) => randomBytes(n).toString("base64url");
const vapid = webpush.generateVAPIDKeys();

console.log(`SESSION_SECRET=${b64(32)}`);
console.log(`ENCRYPTION_KEY=${b64(32)}`);
console.log(`CRON_SECRET=${b64(24)}`);
console.log(`VAPID_PUBLIC_KEY=${vapid.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${vapid.privateKey}`);
