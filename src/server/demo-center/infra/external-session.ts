import {createHmac,randomUUID} from "node:crypto";
import {getSql} from "@/lib/db";
import {getEnv} from "@/lib/env";
import type {ExternalSessionRequest} from "../domain/external-session";
import {SimulatorError} from "./simulator";
import type { Row, TransactionSql } from "postgres";

/** Identidad acreditada por vínculo administrativo; BSUID nunca se infiere como teléfono. */
export function externalIdentityLookup(org:string,account:string,kind:string,value:string){
 return createHmac("sha256",Buffer.from(getEnv().ENCRYPTION_KEY,"base64"))
  .update(JSON.stringify(["demo-channel-identity:v1",org,account,kind,value])).digest("hex");
}
export async function resolveExternalSession(org:string,input:ExternalSessionRequest){
 if(input.organizationId!==org)throw new SimulatorError("not_found",404);
 if(input.identity.kind==="phone"&&!/^\d{7,15}$/.test(input.identity.value))throw new SimulatorError("invalid_identity",422);
 const lookup=externalIdentityLookup(org,input.accountRef,input.identity.kind,input.identity.value);
 return getSql().begin(async sql=>{
  await sql`select id from organization where id=${org} for update`;
  const [binding]=await sql`select b.*,a.state as authorization_state,a.expires_at as authorization_expiry,
    p.status as space_state,p.current_profile_version_id,p.generation as space_generation
    from demo_identity_binding b join demo_authorization a on (a.organization_id,a.space_id,a.id)=(b.organization_id,b.space_id,b.authorization_id)
    join demo_space p on (p.organization_id,p.id)=(b.organization_id,b.space_id)
    where b.organization_id=${org} and b.channel=${input.channel} and b.account_ref=${input.accountRef}
    and a.channel=b.channel and b.identity_kind=${input.identity.kind} and b.identity_lookup=${lookup} and b.state='verified' for update of b,a,p`;
  const [conversation]=await sql`select c.id from conversation c join contact t on (t.organization_id,t.id)=(c.organization_id,c.contact_id)
    where c.organization_id=${org} and c.id=${input.conversationId} and c.channel=${input.channel} and not c.is_test
    and t.wa_identity=${input.identity.kind==='bsuid'?'bsuid:'+input.identity.value:input.identity.value}`;
  const [route]=await sql`select * from demo_identity_route where organization_id=${org} and channel=${input.channel} and identity_lookup=${lookup} for update`;
  const [clock]=await sql`select clock_timestamp() as now`;
  const now=new Date(clock!.now);
  if(!conversation)throw new SimulatorError('not_found',404);
  const valid=binding&&conversation&&binding.authorization_state==='active'&&binding.space_state==='active'&&binding.current_profile_version_id
    &&(!binding.expires_at||new Date(binding.expires_at)>now)&&(!binding.authorization_expiry||new Date(binding.authorization_expiry)>now);
  if(!valid){
   if(route?.mode==='demo'){
    await sql`update demo_session set state='revoked',ended_at=clock_timestamp() where id=${route.session_id} and organization_id=${org} and state='active'`;
    await sql`update demo_identity_route set mode='blocked',session_id=null,generation=generation+1,blocked_since=clock_timestamp(),blocked_reason='authorization_invalid' where id=${route.id}`;
   }
   return {denied:true as const}; // confirmar cuarentena antes de responder error
  }
  const policies=await sql`select * from demo_limits where organization_id=${org} and (space_id is null or space_id=${binding.space_id}) order by space_id nulls first for update`;
  if(policies.length!==2)throw new SimulatorError('policy_required');
  if(policies.some(p=>!p.enabled||new Date(p.window_start)>now||new Date(p.window_end)<=now))throw new SimulatorError('policy_required');
  const [prior]=await sql`select * from demo_session where organization_id=${org} and kind='external' and request_key=${input.requestKey}`;
  if(prior&&(prior.conversation_id!==input.conversationId||prior.authorization_id!==binding.authorization_id))throw new SimulatorError('request_conflict');
  if(route){
   if(route.mode!=='demo')throw new SimulatorError('route_blocked');
   const [session]=await sql`select * from demo_session where organization_id=${org} and id=${route.session_id} and kind='external' for update`;
   if(!session||session.authorization_id!==binding.authorization_id||session.conversation_id!==input.conversationId||session.space_id!==binding.space_id||session.route_generation!==route.generation)throw new SimulatorError('request_conflict');
   if(session.state!=='active'||new Date(session.expires_at)<=now||new Date(session.idle_deadline)<=now){
    await sql`update demo_session set state='expired',ended_at=clock_timestamp() where id=${session.id} and state='active'`;
    await sql`update demo_identity_route set mode='blocked',session_id=null,generation=generation+1,blocked_since=clock_timestamp(),blocked_reason='session_expired' where id=${route.id}`;
    return {denied:true as const};
   }
   return response(session);
  }
  if(prior)throw new SimulatorError('route_blocked');
  return iniciarSesionWhatsApp(sql,org,input,binding,lookup,policies,now);
 }).then(result=>{if('denied' in result)throw new SimulatorError('authorization_unavailable',403);return result;});
}

export async function iniciarSesionWhatsApp(sql:TransactionSql,org:string,input:ExternalSessionRequest,binding:Row,lookup:string,policies:Row[],now:Date,route?:Row){
  if(policies.length!==2)throw new SimulatorError('policy_required');
  for(const p of policies){
   if(!p.enabled||new Date(p.window_start)>now||new Date(p.window_end)<=now||Math.min(p.max_duration_seconds,p.max_idle_seconds,p.max_concurrent_sessions,p.max_sessions_started)<=0)throw new SimulatorError('policy_required');
   const [count]=await sql`select count(*) filter(where state='active' and expires_at>clock_timestamp() and idle_deadline>clock_timestamp())::int as active,
    count(*) filter(where started_at>=${new Date(p.window_start).toISOString()} and started_at<${new Date(p.window_end).toISOString()})::int as started
    from demo_session where organization_id=${org} and (${p.space_id}::text is null or space_id=${p.space_id})`;
   if(count!.active>=p.max_concurrent_sessions||count!.started>=p.max_sessions_started)throw new SimulatorError('quota_exceeded',429);
  }
  const id=randomUUID();const generation=route?Number(route.generation)+1:1;
  const duration=Math.min(...policies.map(p=>Number(p.max_duration_seconds))),idle=Math.min(...policies.map(p=>Number(p.max_idle_seconds)));
  const [session]=await sql`insert into demo_session(id,organization_id,space_id,kind,request_key,authorization_id,conversation_id,profile_version_id,route_generation,state,started_at,expires_at,last_activity_at,idle_deadline,limits_snapshot)
   values(${id},${org},${binding.space_id},'external',${input.requestKey},${binding.authorization_id},${input.conversationId},${binding.current_profile_version_id},${generation},'active',clock_timestamp(),clock_timestamp()+${duration}*interval '1 second',clock_timestamp(),clock_timestamp()+${idle}*interval '1 second',${sql.typed(JSON.stringify(policies),25)}::jsonb) returning *`;
  if(route)await sql`update demo_identity_route set mode='demo',session_id=${id},generation=${generation},
    blocked_since=null,blocked_reason=null,review_due_at=null where id=${route.id}`;
  else await sql`insert into demo_identity_route(id,organization_id,channel,identity_lookup,mode,session_id,generation) values(${randomUUID()},${org},${input.channel},${lookup},'demo',${id},${generation})`;
  await sql`insert into demo_session_event(id,organization_id,space_id,session_id,type,actor,reason_code) values(${randomUUID()},${org},${binding.space_id},${id},'external_started','crm_nea','verified_binding')`;
  const key=randomUUID();
  await sql`insert into demo_admin_audit(id,organization_id,space_id,actor_user_id,action,target_id,reason_code,request_id,result) values(${key},${org},${binding.space_id},${binding.verified_by},'external_session_started',${id},'verified_binding',${key},'success')`;
  return response(session!);
}
function response(s:Record<string,unknown>){return {contractVersion:1,sessionId:s.id,state:s.state,organizationId:s.organization_id,spaceId:s.space_id,conversationId:s.conversation_id,authorizationId:s.authorization_id,profileVersionId:s.profile_version_id,routeGeneration:s.route_generation,expiresAt:new Date(s.expires_at as string).toISOString(),idleDeadline:new Date(s.idle_deadline as string).toISOString()};}
