import Link from "next/link";
import { LogOut } from "lucide-react";
import { logout } from "@/app/actions";
import { Nav } from "@/components/Nav";
import { SyncButton } from "@/components/SyncButton";
import { currentEmail } from "@/lib/auth";
import { sql } from "@/lib/db";
import { fmtAgo } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const email = await currentEmail();
  const [row] = await sql<{ at: Date | null }[]>`select max(last_sync_at) as at from connections where enabled`;
  const lastSync = row?.at ? `${fmtAgo(row.at)} ago`.replace("now ago", "just now") : null;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 sm:px-6">
          <Link href="/" className="flex items-center gap-2 rounded-md">
            <span className="h-2.5 w-2.5 rounded-full bg-gold" aria-hidden />
            <span className="text-[15px] font-semibold tracking-tight text-ink">Apollo</span>
          </Link>
          <div className="order-3 w-full sm:order-none sm:w-auto">
            <Nav />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <SyncButton lastSync={lastSync} />
            <span className="hidden max-w-[220px] truncate text-xs text-muted lg:inline" title={`Signed in as ${email}`}>
              {email}
            </span>
            <form action={logout}>
              <button className="rounded-lg p-2 text-muted transition hover:bg-surface-2 hover:text-ink" aria-label={`Sign out ${email}`} title="Sign out">
                <LogOut className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] px-4 pb-16 pt-6 sm:px-6">{children}</main>
    </div>
  );
}
