import { apiRoot, OPENROUTER_BASE_URL } from "@/lib/ai/presets";
import { createHash, randomUUID } from "node:crypto";
import { getSql } from "@/lib/db";
import { resolveAiProvider } from "@/lib/ai/provider";
import type { AdminActor } from "../domain/contracts";
import { buildSimulatorMessages } from "../domain/simulator";
import { demoKnowledge } from "./knowledge";
import { SimulatorError } from "./simulator";
import { dollars, microCeil, openRouterProvider, type DemoProvider } from "./openrouter";

type Send = {spaceId:string;sessionId:string;requestKey:string;text:string};
const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
export async function configuredDemoProvider(org:string) {
  if(process.env.DEMO_REAL_ENABLED!=="true") throw new SimulatorError("real_not_enabled",403);
  const resolved=await resolveAiProvider(org);
  if(!resolved.ok || apiRoot(resolved.provider.baseUrl)!==apiRoot(OPENROUTER_BASE_URL)) throw new SimulatorError("openrouter_required");
  return openRouterProvider(resolved.provider.token,resolved.provider.model);
}
export async function realDemoSend(actor:AdminActor, command:Send, provider:DemoProvider, external = false, reserveOnly = false, web = false) {
  if(external&&!reserveOnly)throw new SimulatorError("external_execution_not_enabled",403);
  const kind=external?"external":web?"web":"internal";
  const db=getSql(),org=actor.organizationId;
  // Lookup antes de cotizar: una respuesta repetida nunca ejecuta otra generación.
  const [existing]=await db`select o.* from demo_usage_operation o join demo_session s on s.id=o.session_id
    where o.organization_id=${org} and o.operation_key=${command.requestKey}
      and o.space_id=${command.spaceId} and o.session_id=${command.sessionId} and s.kind=${kind}
      and (${external} or s.actor_user_id=${actor.userId})`;
  if(existing){
    if(existing.input_hash!==hash(command.text))throw new SimulatorError("request_conflict");
    return {id:command.sessionId,operationId:existing.id,status:existing.status};
  }
  const quote=await provider.quote().catch((e:unknown)=>{
    const code=e instanceof Error && ["model_price_unavailable","price_unverifiable","openrouter_unavailable"].includes(e.message)?e.message:"quote_unverifiable";
    throw new SimulatorError(code,503);
  });
  const reserved=BigInt(quote.reserve);
  const prepared=await db.begin(async sql=>{
    await sql`select id from organization where id=${org} for update`;
    const [space]=await sql`select * from demo_space where organization_id=${org} and id=${command.spaceId} for update`;
    const [session]=await sql`select * from demo_session where organization_id=${org} and space_id=${command.spaceId}
      and id=${command.sessionId} and kind=${kind} and (${external} or actor_user_id=${actor.userId}) for update`;
    if(!space||!session)throw new SimulatorError("not_found",404);
    if(external){
      const [validExternal]=await sql`select s.id from demo_session s join demo_authorization a on (a.organization_id,a.space_id,a.id)=(s.organization_id,s.space_id,s.authorization_id)
        join demo_identity_route r on r.organization_id=s.organization_id and r.session_id=s.id and r.mode='demo' and r.generation=s.route_generation
        where s.id=${session.id} and s.organization_id=${org} and a.state='active' and (a.expires_at is null or a.expires_at>clock_timestamp()) and exists(select 1 from demo_identity_binding b where b.organization_id=s.organization_id and b.space_id=s.space_id and b.authorization_id=a.id and b.identity_lookup=r.identity_lookup and b.state='verified' and (b.expires_at is null or b.expires_at>clock_timestamp()))`;
      if(!validExternal)throw new SimulatorError('authorization_unavailable',403);
    }
    const [prior]=await sql`select * from demo_usage_operation where organization_id=${org} and operation_key=${command.requestKey}`;
    if(prior){
      if(prior.session_id!==session.id || prior.input_hash!==hash(command.text))throw new SimulatorError("request_conflict");
      return {id:String(prior.id),execute:false,messages:[]};
    }
    const [valid]=await sql`select clock_timestamp()<${new Date(session.expires_at).toISOString()}::timestamptz and clock_timestamp()<${new Date(session.idle_deadline).toISOString()}::timestamptz as ok`;
    if(space.status!=="active"||session.state!=="active"||!valid?.ok)throw new SimulatorError("session_unavailable");
    const [pending]=await sql`select id from demo_usage_operation where session_id=${session.id} and status in ('reserved','uncertain')`;
    if(pending)throw new SimulatorError("operation_pending");
    const [breach]=await sql`select id from demo_usage_operation where organization_id=${org} and actual_amount>reserved_amount and status='uncertain'`;
    if(breach)throw new SimulatorError("cost_breach_review_required");
    const policies=await sql`select * from demo_limits where organization_id=${org} and (space_id is null or space_id=${space.id})
      order by space_id nulls first for update`;
    if(policies.length!==2)throw new SimulatorError("policy_required");
    const snapshot=session.limits_snapshot as Array<Record<string,unknown>>;
    const [usedSession]=await sql`select coalesce(sum(case when status='settled' then actual_amount else greatest(reserved_amount,coalesce(actual_amount,0)) end),0)::text as total
      from demo_usage_operation where session_id=${session.id} and status<>'released'`;
    const sessionCaps=snapshot.map(p=>p.session_budget_micro_usd).filter(v=>v!=null).map(v=>BigInt(String(v)));
    if(!sessionCaps.length)throw new SimulatorError("session_budget_required");
    if(sessionCaps.some(cap=>cap<=0n||BigInt(usedSession!.total)+reserved>cap))throw new SimulatorError("budget_exceeded",429);
    for(const p of policies){
      const now=Date.now();
      if(!p.enabled||new Date(p.window_start).getTime()>now||new Date(p.window_end).getTime()<=now)throw new SimulatorError("policy_required");
      const scope=p.space_id;
      const [usage]=await sql`select coalesce(sum(case when status='settled' then actual_amount else greatest(reserved_amount,coalesce(actual_amount,0)) end),0)::text as total,
        count(*) filter(where status in ('reserved','uncertain'))::int as pending,
        count(*) filter(where attempted_at is not null)::int as calls
        from demo_usage_operation where organization_id=${org} and (${scope}::text is null or space_id=${scope})
          and created_at>=${new Date(p.window_start).toISOString()}::timestamptz and created_at<${new Date(p.window_end).toISOString()}::timestamptz and status<>'released'`;
      const [exception]=await sql`select coalesce(sum(extra_budget_micro_usd),0)::text as extra from demo_limit_exception
        where organization_id=${org} and space_id is not distinct from ${scope}::text and expires_at>clock_timestamp()`;
      if(BigInt(p.budget_micro_usd)<=0n||BigInt(usage!.total)+reserved>BigInt(p.budget_micro_usd)+BigInt(exception!.extra))throw new SimulatorError("budget_exceeded",429);
      if(p.max_concurrent_sessions<=0||usage!.pending>=p.max_concurrent_sessions)throw new SimulatorError("concurrency_exceeded",429);
      const cap=Math.min(p.max_provider_calls,p.max_inbound_messages,p.max_assistant_responses);
      if(cap<=0||usage!.calls+usage!.pending>=cap)throw new SimulatorError("quota_exceeded",429);
    }
    const [calls]=await sql`select count(*)::int as n from demo_usage_operation where session_id=${session.id} and attempted_at is not null`;
    if(snapshot.some(p=>calls!.n>=Number(p.max_provider_calls)))throw new SimulatorError("quota_exceeded",429);
    const history=await sql`select user_text,assistant_text from demo_simulation_turn where session_id=${session.id} order by created_at,id`;
    if(snapshot.some(p=>history.length>=Math.min(Number(p.max_inbound_messages),Number(p.max_assistant_responses),Number(p.max_provider_calls))))throw new SimulatorError("quota_exceeded",429);
    const [profile]=await sql`select * from demo_profile_version where organization_id=${org} and space_id=${space.id} and id=${session.profile_version_id}`;
    if(!profile)throw new SimulatorError("profile_missing");
    const knowledge=await demoKnowledge(actor,command.spaceId,command.text);
    const messages=buildSimulatorMessages({profile:{name:profile.name,role:profile.role,tone:profile.tone,instructions:profile.instructions,greeting:profile.greeting,escalationRules:profile.escalation_rules},
      knowledge:knowledge?.fragments.map(f=>f.text??"")??[],history:[...history.flatMap(t=>[{role:"user" as const,content:String(t.user_text)},{role:"assistant" as const,content:String(t.assistant_text)}]),{role:"user",content:command.text}]});
    if(messages.reduce((n,m)=>n+Buffer.byteLength(m.content,"utf8")+256,256)+quote.output>quote.context) throw new SimulatorError("context_too_large",422);
    const id=randomUUID();
    await sql`insert into demo_usage_operation(id,organization_id,space_id,session_id,operation_key,kind,status,reserved_amount,input_hash,model,user_text,evidence,created_at)
      values(${id},${org},${space.id},${session.id},${command.requestKey},'provider_call','reserved',${String(reserved)},${hash(command.text)},${quote.model},${command.text},${sql.typed(JSON.stringify({quote,policies:policies.map(p=>({id:p.id,version:p.version}))}),25)}::jsonb,clock_timestamp())`;
    const audit=randomUUID();
    await sql`insert into demo_admin_audit(id,organization_id,space_id,actor_user_id,action,target_id,reason_code,request_id,result)
      values(${audit},${org},${space.id},${actor.userId},'llm_reserved',${id},'budget_reservation',${audit},'success')`;
    return {id,execute:true,messages};
  });
  if(reserveOnly){const [op]=await db`select id,status,reserved_amount::text from demo_usage_operation where id=${prepared.id}`;return {id:command.sessionId,operationId:op!.id,status:op!.status,reservedAmount:op!.reserved_amount};}
  if(!prepared.execute)return {id:command.sessionId,operationId:prepared.id,status:"pending"};
  // Última puerta cancelable. Se persiste incertidumbre ANTES del único POST.
  const authorized=await db.begin(async sql=>{
    await sql`select id from organization where id=${org} for update`;
    const [s]=await sql`select s.id from demo_session s join demo_space p on p.id=s.space_id
      where s.id=${command.sessionId} and s.organization_id=${org} and s.actor_user_id=${actor.userId} and s.kind=${kind}
      and s.state='active' and p.status='active' and s.expires_at>clock_timestamp() and s.idle_deadline>clock_timestamp()
      for update of p,s`;
    const [op]=await sql`select evidence from demo_usage_operation where id=${prepared.id}`;
    const saved=op?.evidence?.policies as Array<{id:string;version:number}> | undefined;
    const current=await sql`select id,version from demo_limits where organization_id=${org}
      and (space_id is null or space_id=${command.spaceId}) and enabled=true and window_start<=clock_timestamp() and window_end>clock_timestamp()`;
    const samePolicies=saved?.length===2 && saved.every(p=>current.some(c=>c.id===p.id && c.version===p.version));
    if(!s || !samePolicies || (web && process.env.DEMO_WEB_ENABLED !== "true")){await sql`update demo_usage_operation set status='released' where id=${prepared.id} and status='reserved'`;return false;}
    const rows=await sql`update demo_usage_operation set status='uncertain',attempted_at=clock_timestamp()
      where id=${prepared.id} and status='reserved' returning id`;
    return rows.length===1;
  });
  if(!authorized)return {id:command.sessionId,operationId:prepared.id,status:"released"};
  try{
    const result=await provider.execute(prepared.messages,quote);
    await db`update demo_usage_operation set provider_request_id=${result.id},response_text=${result.text},
      evidence=${db.typed(JSON.stringify({quote,usage:result.usage,model:result.model}),25)}::jsonb where id=${prepared.id}`;
    if(result.cost!==null && (!web || result.model===quote.model))await settleDemoOperation(actor,command.spaceId,prepared.id,result.cost,result.usage,false,web);
  }catch{ /* Resultado incierto: conservar reserva, sin repetir POST ni imprimir contenido. */ }
  const [state]=await db`select status from demo_usage_operation where id=${prepared.id}`;
  return {id:command.sessionId,operationId:prepared.id,status:state!.status};
}

export async function settleDemoOperation(actor:AdminActor,spaceId:string,id:string,cost:string,usage:unknown,external=false,web=false) {
  const actual=microCeil(dollars(cost));
  const kind=external?"external":web?"web":"internal";
  return getSql().begin(async sql=>{
    await sql`select id from organization where id=${actor.organizationId} for update`;
    const [op]=await sql`select o.*,s.state,s.expires_at,s.idle_deadline from demo_usage_operation o
      join demo_session s on s.id=o.session_id where o.id=${id} and o.organization_id=${actor.organizationId}
        and o.space_id=${spaceId} and s.kind=${kind} and (${external} or s.actor_user_id=${actor.userId}) for update of o,s`;
    if(!op)throw new SimulatorError("not_found",404);
    if(op.status==="settled")return;
    if(op.status!=="uncertain")throw new SimulatorError("operation_state");
    // Un exceso de la cota requiere intervención; retener y bloquear en lugar de liberar.
    if(actual>BigInt(op.reserved_amount)){
      await sql`update demo_usage_operation set actual_amount=${String(actual)} where id=${id}`;
      return;
    }
    await sql`update demo_usage_operation set status='settled',actual_amount=${String(actual)},
      evidence=jsonb_set(coalesce(evidence,'{}'::jsonb),'{settlement}',${sql.typed(JSON.stringify({cost,usage}),25)}::jsonb) where id=${id}`;
    const [valid]=await sql`select clock_timestamp()<${new Date(op.expires_at).toISOString()}::timestamptz and clock_timestamp()<${new Date(op.idle_deadline).toISOString()}::timestamptz as ok`;
    if(op.response_text && op.state==="active" && valid?.ok){
      await sql`insert into demo_simulation_turn(id,organization_id,space_id,session_id,request_key,user_text,assistant_text)
        values(${randomUUID()},${actor.organizationId},${spaceId},${op.session_id},${op.operation_key},${op.user_text},${op.response_text}) on conflict do nothing`;
      const limits=await sql`select limits_snapshot from demo_session where id=${op.session_id}`;
      const idle=Math.min(...(limits[0]!.limits_snapshot as Array<Record<string,unknown>>).map(p=>Number(p.max_idle_seconds)));
      if(!external)await sql`update demo_session set last_activity_at=clock_timestamp(),idle_deadline=least(expires_at,clock_timestamp()+${idle}*interval '1 second') where id=${op.session_id}`;
    }
    const key=randomUUID();
    await sql`insert into demo_admin_audit(id,organization_id,space_id,actor_user_id,action,target_id,reason_code,request_id,result)
      values(${key},${actor.organizationId},${spaceId},${actor.userId},'llm_settled',${id},'provider_evidence',${key},'success')`;
  });
}
export async function reconcileDemoOperation(actor:AdminActor,spaceId:string,id:string,provider:DemoProvider,external=false,web=false){
  const sql=getSql();
  const kind=external?"external":web?"web":"internal";
  const [op]=await sql`select o.* from demo_usage_operation o join demo_session s on s.id=o.session_id
    where o.id=${id} and o.organization_id=${actor.organizationId} and o.space_id=${spaceId} and s.kind=${kind}
      and (${external} or s.actor_user_id=${actor.userId})`;
  if(!op)throw new SimulatorError("not_found",404);
  if(op.status==="reserved" && !op.attempted_at){
    await sql.begin(async tx=>{
      await tx`select id from organization where id=${actor.organizationId} for update`;
      const released=await tx`update demo_usage_operation set status='released' where id=${id} and status='reserved' and attempted_at is null returning id`;
      if(released.length){
        const event=randomUUID();
        await tx`insert into demo_admin_audit(id,organization_id,space_id,actor_user_id,action,target_id,reason_code,request_id,result)
          values(${event},${actor.organizationId},${spaceId},${actor.userId},'llm_released',${id},'never_attempted',${event},'success')`;
      }
    });
    return {id:op.session_id,status:"released"};
  }
  if(op.status!=="uncertain")return {id:op.session_id,status:op.status};
  if(!op.provider_request_id)throw new SimulatorError("generation_id_missing");
  const evidence=await provider.reconcile(op.provider_request_id);
  await settleDemoOperation(actor,spaceId,id,evidence.cost,evidence.usage,external,web);
  const [final]=await sql`select status from demo_usage_operation where id=${id}`;
  return {id:op.session_id,status:final!.status};
}
