import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PortalDemo } from "@/components/demo-center/portal";
import { catalogoConversacional, contactoDemoWeb, webHabilitada } from "@/server/demo-center/infra/web";

export const metadata: Metadata = {
  title: "Demostraciones | ModoNext",
  description: "Prueba Vocero con un asistente de IA especializado en un negocio de ejemplo.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";
export default async function PaginaDemos() {
  if (!webHabilitada()) notFound();
  return <PortalDemo contacto={contactoDemoWeb()} catalogo={await catalogoConversacional()} />;
}
