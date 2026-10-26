import { notFound } from "next/navigation";
import { DigestPage } from "@/components/DigestPage";

export const dynamic = "force-dynamic";
// Server actions on this page (sync now, connect account, run agent) can take up to a minute.
export const maxDuration = 60;

export default async function Page({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  return <DigestPage date={date} />;
}
