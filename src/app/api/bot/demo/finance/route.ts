import {z} from "zod";
import {getSql} from "@/lib/db";
import {apiError,parseBody} from "@/lib/api";
import {requireBotKey,resolveInstanceOrg} from "@/server/bot/auth";
import {configuredDemoProvider,realDemoSend,reconcileDemoOperation} from "@/server/demo-center/infra/finance";
import {SimulatorError} from "@/server/demo-center/infra/simulator";
import {canalDemoWhatsApp} from "@/server/demo-center/infra/whatsapp-link";
const id=z.string().min(1).max(128);
const request=z.object({contractVersion:z.literal(1),action:z.enum(['reserve','query','release','settle']),organizationId:id,spaceId:id,sessionId:id,operationKey:id,inputDigest:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export async function POST(req:Request){
 const denied=requireBotKey(req);if(denied)return denied;
 if(process.env.DEMO_EXTERNAL_SESSIONS_ENABLED!=='true')return apiError(503,'demo_disabled','Demo deshabilitada.');
 const parsed=await parseBody(req,request);if(!parsed.ok)return parsed.response;
 const b=parsed.data,org=await resolveInstanceOrg();if(org!==b.organizationId)return apiError(404,'not_found','No disponible.');
 try{
  const sql=getSql();const [s]=await sql`select s.*,a.created_by from demo_session s join demo_authorization a on (a.organization_id,a.space_id,a.id)=(s.organization_id,s.space_id,s.authorization_id) where s.organization_id=${org} and s.space_id=${b.spaceId} and s.id=${b.sessionId} and s.kind='external'`;
  if(!s)throw new SimulatorError('not_found',404);
  const actor={organizationId:org!,userId:String(s.created_by)};
  // El texto es una huella de entrada: no genera contenido ni recibe costos del cliente.
  const {createHash}=await import('node:crypto');const expected=createHash('sha256').update(b.inputDigest).digest('hex');
  let [op]=await sql`select * from demo_usage_operation where organization_id=${org} and operation_key=${b.operationKey}`;
  if(op&&(op.session_id!==s.id||op.space_id!==b.spaceId||op.input_hash!==expected))throw new SimulatorError('request_conflict');
  if(b.action==='reserve'){
   if(!canalDemoWhatsApp()){
    const [linked]=await sql`select 1 from demo_whatsapp_link where organization_id=${org} and external_session_id=${s.id}`;
    if(linked)throw new SimulatorError('authorization_unavailable',403);
   }
   const [valid]=await sql`select s.id from demo_session s join demo_authorization a on a.id=s.authorization_id and a.organization_id=s.organization_id
    join demo_identity_route r on r.session_id=s.id and r.organization_id=s.organization_id and r.mode='demo' and r.generation=s.route_generation
    where s.id=${s.id} and s.state='active' and s.expires_at>clock_timestamp() and s.idle_deadline>clock_timestamp() and a.state='active' and (a.expires_at is null or a.expires_at>clock_timestamp()) and exists(select 1 from demo_identity_binding b where b.organization_id=s.organization_id and b.space_id=s.space_id and b.authorization_id=a.id and b.identity_lookup=r.identity_lookup and b.state='verified' and (b.expires_at is null or b.expires_at>clock_timestamp()))`;
   if(!valid)throw new SimulatorError('authorization_unavailable',403);
   if(!op)await realDemoSend(actor,{spaceId:b.spaceId,sessionId:b.sessionId,requestKey:b.operationKey,text:b.inputDigest},await configuredDemoProvider(org!),true,true);
  }else if(b.action!=='query'){
   if(!op)throw new SimulatorError('not_found',404);
   if(b.action==='release'&&(op.status!=='reserved'||op.attempted_at))throw new SimulatorError('operation_state');
   if(b.action==='settle'&&op.status!=='settled'&&(!op.attempted_at||!op.provider_request_id))throw new SimulatorError('provider_evidence_required');
   if(op.status!=='settled')await reconcileDemoOperation(actor,b.spaceId,op.id,await configuredDemoProvider(org!),true);
  }
  [op]=await sql`select * from demo_usage_operation where organization_id=${org} and operation_key=${b.operationKey} and session_id=${s.id}`;
  if(!op)throw new SimulatorError('not_found',404);
  return Response.json({contractVersion:1,operationId:op.id,operationKey:b.operationKey,status:op.status,reservedMicroUsd:String(op.reserved_amount),actualMicroUsd:op.actual_amount==null?null:String(op.actual_amount)});
 }catch(e){return e instanceof SimulatorError?apiError(e.status,e.code,'Operación financiera no autorizada.'):apiError(503,'finance_unavailable','Contabilidad no disponible.');}
}
