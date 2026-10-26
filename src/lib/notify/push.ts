import "server-only";
import webpush from "web-push";
import { sql } from "../db";
import { env, appUrl } from "../env";

export function pushConfigured(): boolean {
  return !!(env.vapidPublicKey() && env.vapidPrivateKey());
}

/** Sends a browser/phone push notification to every subscribed device. */
export async function sendPush(payload: { title: string; body: string; url?: string; tag?: string }): Promise<number> {
  if (!pushConfigured()) return 0;
  webpush.setVapidDetails(`mailto:${env.gmailSender()}`, env.vapidPublicKey()!, env.vapidPrivateKey()!);
  const subs = await sql<{ endpoint: string; data: webpush.PushSubscription }[]>`select endpoint, data from push_subscriptions`;
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(s.data, JSON.stringify({ ...payload, url: payload.url ?? appUrl() }), { TTL: 3600 });
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await sql`delete from push_subscriptions where endpoint = ${s.endpoint}`;
    }
  }
  return sent;
}
