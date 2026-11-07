import { z } from "zod";
import { MetaApiError } from "@/lib/meta/client";
import { zernioFetch } from "@/server/zernio";

const respuesta = z.object({
  success: z.literal(true),
  data: z.object({ messageId: z.string().min(1) }),
});

/** Una solicitud: solo el llamador puede decidir reintentar con la misma clave. */
export async function enviarTextoWhatsAppZernio(input: {
  token: string;
  cuentaAutorizada: string;
  conversationId: string;
  texto: string;
  idempotencyKey: string;
}): Promise<string> {
  if (!input.token || !input.cuentaAutorizada || !input.conversationId ||
      !input.texto || !input.idempotencyKey) {
    throw new Error("Faltan datos obligatorios para enviar por Zernio");
  }
  let data: unknown;
  try {
    data = await zernioFetch(
      `/inbox/conversations/${encodeURIComponent(input.conversationId)}/messages`,
      { method: "POST", token: input.token, timeoutMs: 15000,
        headers: { "Idempotency-Key": input.idempotencyKey },
        body: { accountId: input.cuentaAutorizada, message: input.texto } }
    );
  } catch (error) {
    const status = error instanceof MetaApiError ? error.status : 0;
    // El cuerpo de error del proveedor puede incluir datos de conversación.
    throw new MetaApiError("No se pudo enviar por Zernio", { status });
  }
  const parsed = respuesta.safeParse(data);
  if (!parsed.success) throw new Error("Zernio no confirmó el identificador del mensaje");
  return parsed.data.data.messageId;
}

/** Consulta acotada al hilo/cuenta y al ID exacto ya confirmado; nunca asocia por texto.
 * Sin ID tras ACK perdido no existe correlación demostrada: conservar incertidumbre.
 */
export async function consultarConfirmacionDemoZernio(input:{organizationId:string;accountRef:string;threadRef:string;requestKey:string;messageId:string|null}):Promise<{messageId:string;status:'sent'|'delivered'|'read'|'failed'}|null>{
 if(!input.messageId)return null;
 const {obtenerZernioWhatsAppPorOrg}=await import("./whatsapp-credenciales");
 const cred=await obtenerZernioWhatsAppPorOrg(input.organizationId);
 if(!cred||cred.accountRef!==input.accountRef)return null;
 const pageSchema=z.object({messages:z.array(z.object({id:z.string(),accountId:z.string(),conversationId:z.string(),platform:z.string(),direction:z.string(),deliveryStatus:z.string().nullable().optional()})),pagination:z.object({hasMore:z.boolean().optional(),nextCursor:z.string().nullable().optional()}).optional()});
 let cursor:string|undefined;
 try{
  for(let page=0;page<3;page++){
   const query=new URLSearchParams({accountId:input.accountRef,sortOrder:'desc',limit:'50'});if(cursor)query.set('cursor',cursor);
   const data=pageSchema.safeParse(await zernioFetch(`/inbox/conversations/${encodeURIComponent(input.threadRef)}/messages?${query}`,{token:cred.token,method:'GET',timeoutMs:15000}));
   if(!data.success)return null;
   const exact=data.data.messages.filter(m=>m.id===input.messageId&&m.accountId===input.accountRef&&m.conversationId===input.threadRef&&m.platform==='whatsapp'&&m.direction==='outgoing');
   if(exact.length===1&&['sent','delivered','read','failed'].includes(exact[0]!.deliveryStatus??''))return {messageId:input.messageId,status:exact[0]!.deliveryStatus as 'sent'|'delivered'|'read'|'failed'};
   if(exact.length>1||!data.data.pagination?.hasMore||!data.data.pagination.nextCursor||data.data.pagination.nextCursor===cursor)return null;
   cursor=data.data.pagination.nextCursor;
  }
 }catch{/* Una consulta fallida no autoriza un nuevo envío. */}
 return null;
}
