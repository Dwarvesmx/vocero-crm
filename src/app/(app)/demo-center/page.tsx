import { notFound } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";
import { canConfigure } from "@/lib/auth/roles";
import { consultarEspacio, consultarExcepciones, consultarPoliticaGlobal, demoKnowledge, listarEspacios } from "@/server/demo-center";
import { DemoCenterAdmin } from "@/components/demo-center/admin";

export default async function DemoCenterPage({ searchParams }: { searchParams: Promise<{ id?: string; vista?: string }> }) {
  const session = await getSessionOrNull();
  if (!session || !canConfigure(session.role)) notFound();
  const { id, vista } = await searchParams;
  const global = !id && vista === "global";
  const [spaces, detail, knowledge, globalPolicy, exceptions] = await Promise.all([
    listarEspacios(session),
    id ? consultarEspacio(session, id) : null,
    id ? demoKnowledge(session, id) : null,
    consultarPoliticaGlobal(session),
    consultarExcepciones(session, id),
  ]);
  if (id && !detail) notFound();
  return <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden" tabIndex={0} aria-label="Contenido de Demo Center"><DemoCenterAdmin key={id ?? (global ? "global" : "new")} spaces={spaces} detail={detail} globalPolicy={globalPolicy} exceptions={exceptions} knowledge={knowledge} global={global} />
  </div>;
}
