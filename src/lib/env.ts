import "server-only";

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

function required(name: string): string {
  const v = optional(name);
  if (!v) throw new Error(`Missing required environment variable ${name}. See SETUP.md.`);
  return v;
}

/** Public base URL of the deployment, without a trailing slash. */
export function appUrl(): string {
  const explicit = optional("APP_URL");
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = optional("VERCEL_PROJECT_PRODUCTION_URL") ?? optional("VERCEL_URL");
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

export const env = {
  databaseUrl: () => optional("DATABASE_URL") ?? optional("POSTGRES_URL") ?? required("DATABASE_URL"),
  sessionSecret: () => required("SESSION_SECRET"),
  encryptionKey: () => required("ENCRYPTION_KEY"),
  cronSecret: () => optional("CRON_SECRET"),
  dashboardPassword: () => optional("DASHBOARD_PASSWORD"),
  dashboardPasswordHash: () => optional("DASHBOARD_PASSWORD_HASH"),
  gmailSender: () => optional("GMAIL_SENDER") ?? "sachitagent29@gmail.com",
  gmailAppPassword: () => optional("GMAIL_APP_PASSWORD"),
  defaultNotifyEmail: () => optional("DEFAULT_NOTIFY_EMAIL") ?? "sachitkumar2025@gmail.com",
  googleClientId: () => optional("GOOGLE_CLIENT_ID"),
  googleClientSecret: () => optional("GOOGLE_CLIENT_SECRET"),
  anthropicApiKey: () => optional("ANTHROPIC_API_KEY"),
  aiModel: () => optional("AI_MODEL") ?? "claude-opus-5-5",
  vapidPublicKey: () => optional("VAPID_PUBLIC_KEY"),
  vapidPrivateKey: () => optional("VAPID_PRIVATE_KEY"),
  ownerName: () => optional("OWNER_NAME") ?? "Sachit",
};
