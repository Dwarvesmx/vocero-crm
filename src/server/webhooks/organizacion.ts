import type { WebhookPayload } from "@/server/inbox/webhook";
import {
  getCredentialsByPhoneNumberId,
  getCredentialsByWabaId,
} from "@/server/whatsapp/credentials";
import { getInstagramCredentialsByIgUserId } from "@/server/instagram/credentials";
import { getMessengerCredentialsByPageId } from "@/server/messenger/credentials";
import { normalizeMetaPagePayload } from "@/server/messenger/ingest";
import { zernioTargetChannel } from "@/server/zernio/dispatch";
import { findZernioConnection } from "@/server/zernio/conexiones";
import type { ZernioEvent } from "@/server/zernio";
import type { FuenteWebhook } from "./eventos";

/**
 * 047 — A qué organización va un evento, resuelto ANTES de guardarlo
 * (`webhook_event.organization_id` es NOT NULL, Principio III).
 *
 * Usa exactamente los buscadores que ya usa la ingesta de cada canal, así que
 * resuelve lo mismo que ella. `null` = nadie conectó ese número o esa cuenta:
 * la ingesta lo iba a descartar igual, y no se guarda.
 *
 * Los buscadores se inyectan para poder probarlo sin base.
 */
export type Buscadores = {
  porPhoneNumberId: (id: string) => Promise<{ organizationId: string } | null>;
  porWabaId: (id: string) => Promise<{ organizationId: string } | null>;
  porIgUserId: (id: string) => Promise<{ organizationId: string } | null>;
  porPageId: (id: string) => Promise<{ organizationId: string } | null>;
  porCuentaZernio: (evt: ZernioEvent) => Promise<{ organizationId: string } | null>;
};

const buscadoresReales: Buscadores = {
  porPhoneNumberId: getCredentialsByPhoneNumberId,
  porWabaId: getCredentialsByWabaId,
  porIgUserId: getInstagramCredentialsByIgUserId,
  porPageId: getMessengerCredentialsByPageId,
  porCuentaZernio: async (evt) => {
    const canal = zernioTargetChannel(evt);
    if (!canal) return null;
    const found = await findZernioConnection(canal, evt.account);
    return found ? { organizationId: found.connection.organizationId } : null;
  },
};

/** La primera organización que se resuelva: una entrega trae una sola cuenta. */
async function primera(
  ids: (string | null | undefined)[],
  buscar: (id: string) => Promise<{ organizationId: string } | null>
): Promise<string | null> {
  for (const id of new Set(ids.filter((x): x is string => Boolean(x)))) {
    const found = await buscar(id);
    if (found) return found.organizationId;
  }
  return null;
}

export async function resolverOrganizacion(
  fuente: FuenteWebhook,
  payload: unknown,
  b: Buscadores = buscadoresReales
): Promise<string | null> {
  switch (fuente) {
    case "whatsapp": {
      const entries = (payload as WebhookPayload).entry ?? [];
      const porNumero = await primera(
        entries.flatMap((e) => (e.changes ?? []).map((c) => c.value?.metadata?.phone_number_id)),
        b.porPhoneNumberId
      );
      // Los estados de plantillas llegan a nivel WABA, sin número.
      return porNumero ?? primera(entries.map((e) => e.id), b.porWabaId);
    }
    case "meta_instagram": {
      const entries = (payload as { entry?: { id?: string }[] }).entry ?? [];
      return primera(entries.map((e) => e.id), b.porIgUserId);
    }
    case "meta_messenger":
      return primera(
        normalizeMetaPagePayload(payload).map((e) => e.routeKey),
        b.porPageId
      );
    case "zernio": {
      const found = await b.porCuentaZernio(payload as ZernioEvent);
      return found?.organizationId ?? null;
    }
    case "zernio_whatsapp":
      // Esta fuente se guarda desde su ruta tras verificar cuenta y firma.
      return null;
  }
}
