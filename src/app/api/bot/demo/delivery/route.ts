import {z} from 'zod';
import {apiError,parseBody} from '@/lib/api';
import {requireBotKey,resolveInstanceOrg} from '@/server/bot/auth';
import {enqueueDemoDelivery,readDemoDelivery} from '@/server/demo-center/infra/delivery';
import {liberarSalidaZernio,recuperarSalidasInciertasZernio} from '@/server/zernio/whatsapp-autorizacion';
import {SimulatorError} from '@/server/demo-center/infra/simulator';
const id=z.string().min(1).max(128);
const schema=z.object({contractVersion:z.literal(1),action:z.enum(['dispatch','query','reconcile']),organizationId:id,sessionId:id,operationKey:id,responseHash:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict();
export async function POST(req:Request){
 const denied=requireBotKey(req);if(denied)return denied;
 if(process.env.DEMO_EXTERNAL_DELIVERY_ENABLED!=='true')return apiError(503,'demo_disabled','Despacho deshabilitado.');
 const body=await parseBody(req,schema);if(!body.ok)return body.response;
 const b=body.data,org=await resolveInstanceOrg();if(org!==b.organizationId)return apiError(404,'not_found','No disponible.');
 try{
  await recuperarSalidasInciertasZernio(org);
  if(b.action==='dispatch'){
   if(!b.responseHash)return apiError(422,'invalid','Falta huella de respuesta.');
   const id=await enqueueDemoDelivery(org,b.sessionId,b.operationKey,b.responseHash);await liberarSalidaZernio(id);
  }
  return Response.json({contractVersion:1,...await readDemoDelivery(org,b.sessionId,b.operationKey,b.action==='reconcile')});
 }catch(e){return e instanceof SimulatorError?apiError(e.status,e.code,'Despacho no autorizado.'):apiError(503,'delivery_unavailable','Estado no disponible.');}
}
