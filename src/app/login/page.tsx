import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-gold" aria-hidden />
          <span className="text-sm font-semibold tracking-tight text-ink">Apollo</span>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-card">
          <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mb-5 mt-1 text-sm text-muted">This dashboard is private. Sign in to continue.</p>
          <LoginForm next={next ?? "/"} />
        </div>
      </div>
    </main>
  );
}
