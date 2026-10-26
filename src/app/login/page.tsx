import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAuthed } from "@/lib/auth";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  not_allowed: "isn't allowed to open this dashboard. Sign in with an approved Google account.",
  cancelled: "Sign-in was cancelled.",
  expired: "That sign-in attempt expired. Please try again.",
  failed: "Google sign-in didn't go through. Please try again.",
  config: "Google sign-in isn't configured yet. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (SETUP.md, step 3).",
};

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="h-[18px] w-[18px]" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; email?: string }> }) {
  const { next, error, email } = await searchParams;
  if (!error && (await isAuthed())) redirect(next?.startsWith("/") && !next.startsWith("//") ? next : "/");
  const message = error ? ERRORS[error] ?? ERRORS.failed : null;
  const href = `/api/auth/google/start${next ? `?next=${encodeURIComponent(next)}` : ""}`;

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-gold" aria-hidden />
          <span className="text-sm font-semibold tracking-tight text-ink">Apollo</span>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-card">
          <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mb-5 mt-1 text-sm text-muted">This dashboard is private. Sign in with an approved Google account.</p>
          {message && (
            <p role="alert" className="mb-4 rounded-lg bg-red-soft px-3 py-2.5 text-sm text-red">
              {error === "not_allowed" ? (
                <>
                  <span className="font-semibold">{email ?? "That account"}</span> {message}
                </>
              ) : (
                message
              )}
            </p>
          )}
          <a
            href={href}
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-line bg-white px-4 py-2.5 text-[15px] font-semibold text-[#1f1f1f] shadow-card transition hover:bg-[#f8f9fa] focus-visible:ring-2 focus-visible:ring-ring"
          >
            <GoogleLogo />
            Sign in with Google
          </a>
        </div>
      </div>
    </main>
  );
}
