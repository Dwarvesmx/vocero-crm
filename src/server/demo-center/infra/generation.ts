import {createHash} from "node:crypto";
import {getSql} from "@/lib/db";
import {demoKnowledge} from "./knowledge";
import {buildSimulatorMessages} from "../domain/simulator";
import {settleDemoOperation} from "./finance";
import {SimulatorError} from "./simulator";
import type {DemoProvider,Quote} from "./openrouter";
export async function generateExternal(org:string,space:string,session:string,key:string,text:string,provider:DemoProvider){
 const db=getSql(),digest=createHash('sha256').update(text).digest('hex');
 const prepared=await db.begin(async sql=>{
  await sql`select id from organization where id=${org} for update`;
  const [s]=await sql`select s.*,a.created_by from demo_session s join demo_authorization a on (a.organization_id,a.space_id,a.id)=(s.organization_id,s.space_id,s.authorization_id)
    join demo_space p on (p.organization_id,p.id)=(s.organization_id,s.space_id)
    join demo_identity_route r on r.organization_id=s.organization_id and r.session_id=s.id and r.mode='demo' and r.generation=s.route_generation
    where s.organization_id=${org} and s.space_id=${space} and s.id=${session} and s.kind='external' and s.state='active'
    and s.expires_at>clock_timestamp() and s.idle_deadline>clock_timestamp() and a.state='active' and p.status='active' and (a.expires_at is null or a.expires_at>clock_timestamp())
    and exists(select 1 from demo_identity_binding b where b.organization_id=s.organization_id and b.authorization_id=a.id and b.identity_lookup=r.identity_lookup and b.state='verified' and (b.expires_at is null or b.expires_at>clock_timestamp())) for update of s,a,p,r`;
  if(!s)throw new SimulatorError('authorization_unavailable',403);
  const [op]=await sql`select * from demo_usage_operation where organization_id=${org} and space_id=${space} and session_id=${session} and operation_key=${key} for update`;
  if(!op)throw new SimulatorError('reservation_required',409);
  if(op.input_hash!==createHash('sha256').update(digest).digest('hex'))throw new SimulatorError('request_conflict');
  if(op.status!=='reserved'||op.attempted_at)return {op,execute:false,actor:String(s.created_by),messages:[],quote:null};
  const quote=op.evidence?.quote as Quote|undefined;
  if(!quote||quote.model!==op.model||quote.reserve!==String(op.reserved_amount))throw new SimulatorError('quote_unverifiable');
  const policies=await sql`select id,version from demo_limits where organization_id=${org} and (space_id is null or space_id=${space}) and enabled and window_start<=clock_timestamp() and window_end>clock_timestamp()`;
  const saved=op.evidence?.policies as Array<{id:string;version:number}>|undefined;
  if(policies.length!==2||saved?.length!==2||!saved.every(p=>policies.some(c=>c.id===p.id&&c.version===p.version)))throw new SimulatorError('policy_required');
  const [profile]=await sql`select * from demo_profile_version where organization_id=${org} and space_id=${space} and id=${s.profile_version_id}`;
  if(!profile)throw new SimulatorError('profile_missing');
  const history=await sql`select user_text,assistant_text from demo_simulation_turn where organization_id=${org} and space_id=${space} and session_id=${session} order by created_at,id`;
  const knowledge=await demoKnowledge({organizationId:org,userId:String(s.created_by)},space,text);
  const messages=buildSimulatorMessages({profile:{name:profile.name,role:profile.role,tone:profile.tone,instructions:profile.instructions,greeting:profile.greeting,escalationRules:profile.escalation_rules},knowledge:knowledge?.fragments.map(f=>f.text??'')??[],history:[...history.flatMap(t=>[{role:'user' as const,content:String(t.user_text)},{role:'assistant' as const,content:String(t.assistant_text)}]),{role:'user',content:text}]});
  if(messages.reduce((n,m)=>n+Buffer.byteLength(m.content,'utf8')+256,256)+quote.output>quote.context)throw new SimulatorError('context_too_large',422);
  const idle=Math.min(...(s.limits_snapshot as Array<Record<string,unknown>>).map(p=>Number(p.max_idle_seconds)));
  await sql`update demo_session set last_activity_at=clock_timestamp(),idle_deadline=least(expires_at,clock_timestamp()+${idle}*interval '1 second') where id=${session}`;
  await sql`update demo_usage_operation set status='uncertain',attempted_at=clock_timestamp(),user_text=${text} where id=${op.id}`;
  return {op,execute:true,actor:String(s.created_by),messages,quote};
 });
 if(prepared.execute){
  try{
   const result=await provider.execute(prepared.messages,prepared.quote!);
   await db`update demo_usage_operation set provider_request_id=${result.id},response_text=${result.text},evidence=jsonb_set(evidence,'{provider}',${db.typed(JSON.stringify({usage:result.usage,model:result.model}),25)}::jsonb) where id=${prepared.op.id}`;
   if(result.cost!==null&&result.model===prepared.quote!.model)await settleDemoOperation({organizationId:org,userId:prepared.actor},space,prepared.op.id,result.cost,result.usage,true);
  }catch{ /* nexo externo incierto: nunca repetir generación */ }
 }
 const [allowed]=await db`select s.id from demo_session s join demo_authorization a on a.id=s.authorization_id and a.organization_id=s.organization_id
  join demo_space p on p.organization_id=s.organization_id and p.id=s.space_id and p.status='active'
  join demo_identity_route r on r.session_id=s.id and r.organization_id=s.organization_id and r.mode='demo' and r.generation=s.route_generation
  where s.id=${session} and s.organization_id=${org} and exists(select 1 from demo_identity_binding b where b.organization_id=s.organization_id and b.space_id=s.space_id and b.authorization_id=a.id and b.identity_lookup=r.identity_lookup and b.state='verified' and (b.expires_at is null or b.expires_at>clock_timestamp())) and s.state='active' and s.expires_at>clock_timestamp() and s.idle_deadline>clock_timestamp() and a.state='active' and (a.expires_at is null or a.expires_at>clock_timestamp())`;
 const [result]=await db`select id,status,response_text,provider_request_id,actual_amount::text from demo_usage_operation where id=${prepared.op.id}`;
 return {contractVersion:1,operationId:result!.id,status:result!.status,text:allowed&&result!.status==='settled'?result!.response_text:null,generationId:result!.provider_request_id,actualMicroUsd:result!.actual_amount};
}
