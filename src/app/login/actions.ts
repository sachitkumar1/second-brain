"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyPassword } from "@/lib/crypto";
import { sql } from "@/lib/db";
import { SESSION_COOKIE, SESSION_TTL_DAYS, signSession } from "@/lib/session";

export async function login(_prev: { error?: string } | null, form: FormData): Promise<{ error?: string }> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from login_attempts where ip = ${ip} and at > now() - interval '15 minutes'`;
  if (n >= 8) return { error: "Too many attempts. Try again in 15 minutes." };

  const password = String(form.get("password") ?? "");
  if (!verifyPassword(password)) {
    await sql`insert into login_attempts (ip) values (${ip})`;
    return { error: "Wrong password." };
  }
  await sql`delete from login_attempts where ip = ${ip} or at < now() - interval '1 day'`;
  (await cookies()).set(SESSION_COOKIE, await signSession(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_DAYS * 86_400,
  });
  const next = String(form.get("next") ?? "/");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}
