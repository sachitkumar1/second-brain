import type { Metadata } from "next";
import { DigestPage } from "@/components/DigestPage";

export const dynamic = "force-dynamic";
// Server actions on this page (sync now, connect account, run agent) can take up to a minute.
export const maxDuration = 60;
export const metadata: Metadata = { title: "Digest" };

export default function Page() {
  return <DigestPage />;
}
