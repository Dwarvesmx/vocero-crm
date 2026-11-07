import {z} from 'zod';
import {apiError,parseBody} from '@/lib/api';
import {requireBotKey,resolveInstanceOrg} from '@/server/bot/auth';
import {configuredDemoProvider} from '@/server/demo-center/infra/finance';
import {generateExternal} from '@/server/demo-center/infra/generation';
import {SimulatorError} from '@/server/demo-center/infra/simulator';
const id=z.string().min(1).max(128);
const schema=z.object({contractVersion:z.literal(1),organizationId:id,spaceId:id,sessionId:id,operationKey:id,text:z.string().trim().min(1).max(2000)}).strict();
export async function POST(req:Request){
 const denied=requireBotKey(req);if(denied)return denied;
 if(process.env.DEMO_EXTERNAL_GENERATION_ENABLED!=='true'||process.env.DEMO_EXTERNAL_SESSIONS_ENABLED!=='true')return apiError(503,'demo_disabled','Generación deshabilitada.');
 const body=await parseBody(req,schema);if(!body.ok)return body.response;
 const b=body.data,org=await resolveInstanceOrg();if(org!==b.organizationId)return apiError(404,'not_found','No disponible.');
 try{return Response.json(await generateExternal(org,b.spaceId,b.sessionId,b.operationKey,b.text,await configuredDemoProvider(org)));}
 catch(e){return e instanceof SimulatorError?apiError(e.status,e.code,'Generación bloqueada.'):apiError(503,'generation_unavailable','No disponible.');}
}
