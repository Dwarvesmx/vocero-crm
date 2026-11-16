import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { canConfigure } from "@/lib/auth/roles";
import { comercialEnabled } from "@/server/comercial/service";
import { ComercialPanel } from "@/components/comercial/panel";
export const dynamic = "force-dynamic";
export default async function ComercialPage() {
  const session = await requireSession();
  if (!comercialEnabled() || !canConfigure(session.role)) notFound();
  return <ComercialPanel />;
}
