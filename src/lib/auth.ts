import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, sessionEmail, verifySession } from "./session";

/** Throws a redirect to /login when there is no valid session. Use in pages and server actions. */
export async function requireSession(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await verifySession(token))) redirect("/login");
}

/** The Google account you're signed in with. Redirects to /login when signed out. */
export async function currentEmail(): Promise<string> {
  const email = await sessionEmail((await cookies()).get(SESSION_COOKIE)?.value);
  if (!email) redirect("/login");
  return email;
}

export async function isAuthed(): Promise<boolean> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySession(token);
}

/** For route handlers that authenticate with a bearer secret (cron, Mac agent). */
export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}
