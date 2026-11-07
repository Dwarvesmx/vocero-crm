import {apiError,parseBody} from "@/lib/api";
import {requireBotKey,resolveInstanceOrg} from "@/server/bot/auth";
import {externalSessionRequest} from "@/server/demo-center/domain/external-session";
import {resolveExternalSession} from "@/server/demo-center/infra/external-session";
import {SimulatorError} from "@/server/demo-center/infra/simulator";
export async function POST(req:Request){
 const denied=requireBotKey(req);if(denied)return denied;
 if(process.env.DEMO_EXTERNAL_SESSIONS_ENABLED!=="true")return apiError(503,"demo_disabled","Canal demo deshabilitado.");
 const body=await parseBody(req,externalSessionRequest);if(!body.ok)return body.response;
 const org=await resolveInstanceOrg();if(!org)return apiError(404,"not_found","No disponible.");
 try{return Response.json(await resolveExternalSession(org,body.data));}
 catch(e){return e instanceof SimulatorError?apiError(e.status,e.code,"No se pudo autorizar la sesión demo."):apiError(503,"session_unavailable","Resolución no disponible.");}
}
