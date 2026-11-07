import { randomUUID } from "node:crypto";
import { getSql } from "@/lib/db";
import type { AdminActor } from "../domain/contracts";
import { buildSimulatorMessages } from "../domain/simulator";
import { demoKnowledge } from "./knowledge";

export class SimulatorError extends Error {
  constructor(public code: string, public status = 409) { super(code); }
}
export type SimulatorCommand =
  | { action: "start"; spaceId: string; requestKey: string }
  | { action: "send"; spaceId: string; sessionId: string; requestKey: string; text: string }
  | { action: "close"; spaceId: string; sessionId: string };

export async function simulatorRead(actor: AdminActor, spaceId: string, sessionId?: string) {
  const sql = getSql();
  if (!sessionId) {
    return sql`select id, state, profile_version_id, expires_at from demo_session
      where organization_id=${actor.organizationId} and space_id=${spaceId}
        and kind='internal' and actor_user_id=${actor.userId} order by started_at desc limit 25`;
  }
  const [session] = await sql`select s.*, p.name as assistant_name, p.version as profile_version
    from demo_session s join demo_profile_version p on p.id=s.profile_version_id
    where s.organization_id=${actor.organizationId} and s.space_id=${spaceId}
      and s.id=${sessionId} and s.kind='internal' and s.actor_user_id=${actor.userId}`;
  if (!session) throw new SimulatorError("not_found", 404);
  const turns = await sql`select id,user_text,assistant_text,created_at from demo_simulation_turn
    where organization_id=${actor.organizationId} and space_id=${spaceId} and session_id=${sessionId}
    order by created_at,id`;
  const operations=await sql`select id,status,model,reserved_amount::text,actual_amount::text,provider_request_id,evidence,created_at
    from demo_usage_operation where organization_id=${actor.organizationId} and space_id=${spaceId} and session_id=${sessionId} order by created_at`;
  const policies=await sql`select p.space_id,p.budget_micro_usd::text as budget,
    coalesce((select sum(case when o.status='settled' then coalesce(o.actual_amount,0) else greatest(o.reserved_amount,coalesce(o.actual_amount,0)) end)
      from demo_usage_operation o where o.organization_id=p.organization_id and (p.space_id is null or o.space_id=p.space_id)
      and o.created_at>=p.window_start and o.created_at<p.window_end and o.status<>'released'),0)::text as used
    from demo_limits p where p.organization_id=${actor.organizationId} and (p.space_id is null or p.space_id=${spaceId})`;
  const budgets=policies.map(p=>({scope:p.space_id?"space":"global",budget:p.budget,used:p.used,
    available:String(BigInt(p.budget)>BigInt(p.used)?BigInt(p.budget)-BigInt(p.used):0n)}));
  return { session, turns, operations, budgets };
}

export async function simulatorCommand(actor: AdminActor, command: SimulatorCommand, web?: { tokenHash?: string }) {
  if (web && (command.action === "send" || (command.action === "start" && !web.tokenHash))) {
    throw new SimulatorError("invalid", 422);
  }
  const kind = web ? "web" : "internal";
  const db = getSql();
  return db.begin(async sql => {
    const org = actor.organizationId;
    // Orden único para inicios, turnos y cierres. No hay HTTP dentro de esta transacción.
    await sql`select id from organization where id=${org} for update`;
    const [space] = await sql`select * from demo_space where organization_id=${org} and id=${command.spaceId} for update`;
    if (!space) throw new SimulatorError("not_found", 404);
    if (command.action === "start") {
      const [prior] = await sql`select * from demo_session where organization_id=${org}
        and kind=${kind} and actor_user_id=${actor.userId} and request_key=${command.requestKey}`;
      if (prior) {
        if (prior.space_id !== command.spaceId) throw new SimulatorError("request_conflict");
        return { id: prior.id };
      }
    }
    const [session] = command.action !== "start" ? await sql`select * from demo_session
      where id=${command.sessionId} and organization_id=${org} and space_id=${command.spaceId}
        and kind=${kind} and actor_user_id=${actor.userId} for update` : [];
    if (command.action !== "start" && !session) throw new SimulatorError("not_found", 404);
    async function audit(type: string, id: string) {
      const key = randomUUID();
      await sql`insert into demo_session_event(id,organization_id,space_id,session_id,type,actor,reason_code)
        values(${randomUUID()},${org},${command.spaceId},${id},${type},${web ? "prospect_invitation" : actor.userId},${web ? "web_demo" : "internal_simulation"})`;
      await sql`insert into demo_admin_audit(id,organization_id,space_id,actor_user_id,action,target_id,reason_code,request_id,result)
        values(${key},${org},${command.spaceId},${actor.userId},${type},${id},${web ? "web_demo" : "internal_simulation"},${key},'success')`;
    }
    if (command.action === "close") {
      if (session!.state === "active") {
        await sql`update demo_session set state='closed',ended_at=clock_timestamp() where id=${session!.id}`;
        await audit(web ? "web_demo_closed" : "simulation_closed", String(session!.id));
      }
      return { id: session!.id };
    }
    if (command.action === "send") {
      const [prior] = await sql`select * from demo_simulation_turn where session_id=${session!.id} and request_key=${command.requestKey}`;
      if (prior) {
        if (prior.user_text !== command.text) throw new SimulatorError("request_conflict");
        return { id: session!.id };
      }
    }
    const [clock] = await sql`select clock_timestamp() as time`;
    const now = new Date(clock!.time);
    if (space.status !== "active" || !space.current_profile_version_id) throw new SimulatorError("space_unavailable");
    if (session && (session.state !== "active" || new Date(session.expires_at) <= now || new Date(session.idle_deadline) <= now)) {
      throw new SimulatorError("session_unavailable");
    }
    const policies = await sql`select * from demo_limits where organization_id=${org}
      and (space_id is null or space_id=${command.spaceId}) order by space_id nulls first for update`;
    if (policies.length !== 2) throw new SimulatorError("policy_required");
    const fields = ["max_duration_seconds","max_idle_seconds","max_concurrent_sessions","max_sessions_started","max_inbound_messages","max_assistant_responses","max_provider_calls"];
    for (const policy of policies) {
      if (!policy.enabled || new Date(policy.window_start) > now || new Date(policy.window_end) <= now ||
          fields.some(field => Number(policy[field]) <= 0)) throw new SimulatorError("policy_required");
      const scope = policy.space_id;
      const [counts] = await sql`select
        count(*) filter(where state='active' and expires_at>clock_timestamp() and idle_deadline>clock_timestamp())::int as active,
        count(*) filter(where started_at>=${new Date(policy.window_start).toISOString()} and started_at<${new Date(policy.window_end).toISOString()})::int as started
        from demo_session where organization_id=${org} and (${scope}::text is null or space_id=${scope})`;
      if (command.action === "start" && (counts!.active >= policy.max_concurrent_sessions || counts!.started >= policy.max_sessions_started)) {
        throw new SimulatorError("quota_exceeded", 429);
      }
      if (command.action === "send") {
        const [counts] = await sql`select count(*)::int as n from demo_simulation_turn
          where organization_id=${org} and (${scope}::text is null or space_id=${scope})
            and created_at>=${new Date(policy.window_start).toISOString()} and created_at<${new Date(policy.window_end).toISOString()}`;
        if (["max_inbound_messages","max_assistant_responses","max_provider_calls"].some(field => counts!.n >= Number(policy[field]))) {
          throw new SimulatorError("quota_exceeded", 429);
        }
      }
    }
    if (command.action === "start") {
      if (web && (!policies.every(p => BigInt(p.budget_micro_usd) > 0n) ||
          !policies.some(p => p.session_budget_micro_usd != null) ||
          policies.some(p => p.session_budget_micro_usd != null && BigInt(p.session_budget_micro_usd) <= 0n))) {
        throw new SimulatorError("session_budget_required");
      }
      const id = randomUUID();
      const duration = Math.min(...policies.map(p => Number(p.max_duration_seconds)));
      const idle = Math.min(...policies.map(p => Number(p.max_idle_seconds)));
      const snapshot = sql.typed(JSON.stringify(Array.from(policies)), 25);
      await sql`insert into demo_session(id,organization_id,space_id,kind,actor_user_id,request_key,web_token_hash,profile_version_id,
        route_generation,state,started_at,expires_at,last_activity_at,idle_deadline,limits_snapshot)
        values(${id},${org},${command.spaceId},${kind},${actor.userId},${command.requestKey},${web?.tokenHash ?? null},${space.current_profile_version_id},
        ${space.generation},'active',clock_timestamp(),clock_timestamp()+${duration}*interval '1 second',clock_timestamp(),clock_timestamp()+${idle}*interval '1 second',${snapshot}::jsonb)`;
      await audit(web ? "web_demo_invited" : "simulation_started", id);
      return { id };
    }
    const history = await sql`select user_text,assistant_text from demo_simulation_turn
      where session_id=${session!.id} order by created_at,id`;
    const limits = session!.limits_snapshot as Array<Record<string, unknown>>;
    for (const policy of limits) {
      if (["max_inbound_messages","max_assistant_responses","max_provider_calls"].some(field => history.length >= Number(policy[field]))) throw new SimulatorError("quota_exceeded",429);
    }
    const [profile] = await sql`select * from demo_profile_version where organization_id=${org}
      and space_id=${command.spaceId} and id=${session!.profile_version_id}`;
    if (!profile) throw new SimulatorError("profile_missing");
    const knowledge = await demoKnowledge(actor, command.spaceId, command.text);
    const context = buildSimulatorMessages({
      profile: { name: profile.name, role: profile.role, tone: profile.tone, instructions: profile.instructions,
        greeting: profile.greeting, escalationRules: profile.escalation_rules },
      knowledge: knowledge?.fragments.map(f => f.text ?? "") ?? [],
      history: [...history.flatMap(t => [{role:"user" as const,content:t.user_text as string},{role:"assistant" as const,content:t.assistant_text as string}]),
        {role:"user",content:command.text}],
    });
    // Proveedor cerrado: no se aceptan URLs, modelos ni adaptadores desde la petición.
    if (command.text === "/error-simulado") throw new SimulatorError("simulated_provider_error",503);
    const answer = `[Simulado · ${profile.name} v${profile.version}] ${knowledge?.fragments.map(f => f.text).join("\n") || "Sin conocimiento coincidente."} (Historial: ${context.length - 2} mensajes)`;
    await sql`insert into demo_simulation_turn(id,organization_id,space_id,session_id,request_key,user_text,assistant_text)
      values(${randomUUID()},${org},${command.spaceId},${session!.id},${command.requestKey},${command.text},${answer})`;
    const idle = Math.min(...policies.map(p => Number(p.max_idle_seconds)),...limits.map(p => Number(p.max_idle_seconds)));
    await sql`update demo_session set last_activity_at=clock_timestamp(),idle_deadline=least(expires_at,clock_timestamp()+${idle}*interval '1 second') where id=${session!.id}`;
    await audit("simulation_turn",String(session!.id));
    return { id: session!.id };
  });
}
