import {randomUUID,createHash} from 'node:crypto';
import {getSql} from '@/lib/db';
import {SimulatorError} from './simulator';
import {externalIdentityLookup} from './external-session';
import {descifrar} from '@/server/zernio/whatsapp-credenciales';
import {consultarConfirmacionDemoZernio} from '@/server/zernio/whatsapp-envio';

async function resolve(sql:ReturnType<typeof getSql>,org:string,session:string,operation:string){
 const [row]=await sql`select s.id as session_id,s.space_id,s.route_generation,s.authorization_id,
  c.id as conversation_id,c.channel_thread_ref,c.ai_enabled,c.handoff_at,c.handoff_pending_message_id,(c.last_inbound_at at time zone 'UTC') as last_inbound_at,t.wa_identity,
  a.state as authorization_state,a.expires_at as authorization_expiry,p.status as space_state,s.state as session_state,s.expires_at,s.idle_deadline,
  b.account_ref,b.identity_kind,b.identity_lookup,b.expires_at as binding_expiry,b.state as binding_state,r.mode,r.generation,
  o.id as operation_id,o.response_text,o.status as financial_state
  from demo_session s join demo_authorization a on (a.organization_id,a.space_id,a.id)=(s.organization_id,s.space_id,s.authorization_id)
  join demo_space p on (p.organization_id,p.id)=(s.organization_id,s.space_id)
  join demo_identity_route r on r.organization_id=s.organization_id and r.session_id=s.id
  join demo_identity_binding b on (b.organization_id,b.space_id,b.authorization_id,b.identity_lookup)=(s.organization_id,s.space_id,a.id,r.identity_lookup)
  join conversation c on (c.organization_id,c.id)=(s.organization_id,s.conversation_id)
  join contact t on (t.organization_id,t.id)=(c.organization_id,c.contact_id)
  join demo_usage_operation o on o.organization_id=s.organization_id and o.session_id=s.id and o.operation_key=${operation}
  where s.organization_id=${org} and s.id=${session} and s.kind='external' and c.channel='whatsapp' and not c.is_test
  and b.state='verified' for update of s,a,p,r,b,c,t,o`;
 if(!row)throw new SimulatorError('not_found',404);
 const [clock]=await sql`select clock_timestamp() as now`;
 const now=new Date(clock!.now).getTime();
 const identity=String(row.wa_identity);const value=row.identity_kind==='bsuid'?identity.startsWith('bsuid:')?identity.slice(6):'':identity;
 const valid=row.financial_state==='settled'&&row.response_text&&row.authorization_state==='active'&&row.space_state==='active'&&row.session_state==='active'
  &&row.binding_state==='verified'&&row.mode==='demo'&&row.generation===row.route_generation&&row.ai_enabled&&!row.handoff_at&&!row.handoff_pending_message_id
  &&row.channel_thread_ref&&row.last_inbound_at&&now-new Date(row.last_inbound_at).getTime()>=0&&now-new Date(row.last_inbound_at).getTime()<86400000
  &&new Date(row.expires_at).getTime()>now&&new Date(row.idle_deadline).getTime()>now
  &&(!row.authorization_expiry||new Date(row.authorization_expiry).getTime()>now)&&(!row.binding_expiry||new Date(row.binding_expiry).getTime()>now)
  &&externalIdentityLookup(org,row.account_ref,row.identity_kind,value)===row.identity_lookup;
 if(!valid)throw new SimulatorError('delivery_unauthorized',403);
 return row;
}
export async function enqueueDemoDelivery(org:string,session:string,operation:string,responseHash:string){
 const db=getSql();return db.begin(async sql=>{
  await sql`select id from organization where id=${org} for update`;
  const row=await resolve(sql as unknown as ReturnType<typeof getSql>,org,session,operation);
  if(createHash('sha256').update(row.response_text).digest('hex')!==responseHash)throw new SimulatorError('response_conflict');
  const key='demo:'+row.operation_id;
  const [prior]=await sql`select j.*,m.scope_kind,m.demo_session_id,m.text from zernio_whatsapp_outbox j join message m on m.id=j.message_id and m.organization_id=j.organization_id where j.organization_id=${org} and j.request_key=${key}`;
  if(prior){
   if(prior.scope_kind!=='demo'||prior.demo_session_id!==session||prior.text!==row.response_text||prior.conversation_id!==row.conversation_id||prior.account_ref!==row.account_ref||prior.thread_ref!==row.channel_thread_ref)throw new SimulatorError('delivery_conflict');
   return String(prior.id);
  }
  const message=randomUUID(),id=randomUUID();
  await sql`insert into message(id,organization_id,conversation_id,direction,type,text,status,origin,ai_generated,scope_kind,demo_session_id,route_generation)
    values(${message},${org},${row.conversation_id},'out','text',${row.response_text},'pending','ai',true,'demo',${session},${row.route_generation})`;
  await sql`insert into zernio_whatsapp_outbox(id,organization_id,conversation_id,message_id,account_ref,thread_ref,request_key,status)
    values(${id},${org},${row.conversation_id},${message},${row.account_ref},${row.channel_thread_ref},${key},'retenido')`;
  await sql`insert into demo_session_event(id,organization_id,space_id,session_id,type,actor,reason_code,metadata)
    values(${randomUUID()},${org},${row.space_id},${session},'delivery_pending','nea','generated_response',${sql.typed(JSON.stringify({outboxId:id,operationId:row.operation_id}),25)}::jsonb)`;
  return id;
 });
}
/** Puerto usado por el MISMO outbox antes de su único POST externo. */
export async function authorizeDemoDelivery(id:string){
 if(process.env.DEMO_EXTERNAL_DELIVERY_ENABLED!=='true'||process.env.ZERNIO_WHATSAPP_ENABLED!=='true')return null;
 const db=getSql();return db.begin(async sql=>{
  const [ref]=await sql`select j.*,m.demo_session_id,m.scope_kind,m.route_generation,m.text from zernio_whatsapp_outbox j join message m on m.id=j.message_id and m.organization_id=j.organization_id where j.id=${id}`;
  if(!ref||ref.scope_kind!=='demo'||ref.status!=='retenido'||!ref.request_key.startsWith('demo:'))return null;
  await sql`select id from organization where id=${ref.organization_id} for update`;
  const [op]=await sql`select operation_key from demo_usage_operation where organization_id=${ref.organization_id} and id=${ref.request_key.slice(5)} and session_id=${ref.demo_session_id}`;
  let row;
  try{if(!op)throw Error('not_found');row=await resolve(sql as unknown as ReturnType<typeof getSql>,ref.organization_id,ref.demo_session_id,op.operation_key);}
  catch{
   await sql`update zernio_whatsapp_outbox set status='cancelado',updated_at=clock_timestamp() where id=${id} and status='retenido'`;
   await sql`update message set status='failed' where id=${ref.message_id} and scope_kind='demo'`;
   return null;
  }
  const [cred]=await sql`select * from zernio_whatsapp_credentials where organization_id=${ref.organization_id} and enabled for update`;
  if(!cred||cred.account_ref!==ref.account_ref)throw new SimulatorError('transport_unavailable',503); // no efecto iniciado: reintento seguro
  if(ref.account_ref!==row.account_ref||ref.thread_ref!==row.channel_thread_ref||ref.conversation_id!==row.conversation_id||ref.route_generation!==row.route_generation||ref.text!==row.response_text)throw new SimulatorError('delivery_conflict');
  const [job]=await sql`update zernio_whatsapp_outbox set status='iniciado',attempts=attempts+1,leased_until=clock_timestamp()+interval '120 seconds',updated_at=clock_timestamp() where id=${id} and status='retenido' returning *`;
  if(!job)return null;
  // Convertir nombres postgres al contrato existente sin duplicar el transporte.
  return {job:{id:job.id,organizationId:job.organization_id,conversationId:job.conversation_id,messageId:job.message_id,accountRef:job.account_ref,threadRef:job.thread_ref,requestKey:job.request_key,attempts:job.attempts,handoffReason:null},text:String(ref.text),credentials:descifrar({organizationId:cred.organization_id,accountRef:cred.account_ref,tokenCipher:cred.token_cipher,tokenIv:cred.token_iv,tokenTag:cred.token_tag,secretCipher:cred.secret_cipher,secretIv:cred.secret_iv,secretTag:cred.secret_tag} as Parameters<typeof descifrar>[0]),demo:true};
 });
}
export async function readDemoDelivery(org:string,session:string,operation:string,reconcile=false){
 const db=getSql();const [row]=await db`select j.id,j.status,j.account_ref,j.thread_ref,j.request_key,m.id as message_id,m.status as message_status,m.wa_message_id
  from zernio_whatsapp_outbox j join message m on m.id=j.message_id and m.organization_id=j.organization_id
  join demo_usage_operation o on j.request_key='demo:'||o.id and o.organization_id=j.organization_id
  where j.organization_id=${org} and m.scope_kind='demo' and m.demo_session_id=${session} and o.session_id=${session} and o.operation_key=${operation}`;
 if(!row)throw new SimulatorError('not_found',404);
 if(reconcile&&['iniciado','incierto','completado'].includes(row.status)){
  const receipt=await consultarConfirmacionDemoZernio({organizationId:org,accountRef:row.account_ref,threadRef:row.thread_ref,requestKey:row.request_key,messageId:row.wa_message_id});
  if(receipt){
   if(row.wa_message_id&&row.wa_message_id!==receipt.messageId)throw new SimulatorError('receipt_conflict');
   await db.begin(async tx=>{
    const [current]=await tx`select status from zernio_whatsapp_outbox where id=${row.id} for update`;
    if(!current||!['iniciado','incierto','completado'].includes(current.status))throw new SimulatorError('receipt_conflict');
    const [message]=await tx`select status,wa_message_id from message where id=${row.message_id} for update`;
    if(message?.wa_message_id&&message.wa_message_id!==receipt.messageId)throw new SimulatorError('receipt_conflict');
    if(receipt.status==='failed'&&['delivered','read'].includes(message!.status))return;
    await tx`update message set wa_message_id=${receipt.messageId},status=case when status='read' then 'read' when status='delivered' then 'delivered' else ${receipt.status} end,error=null where id=${row.message_id}`;
    await tx`update zernio_whatsapp_outbox set status=${receipt.status==='failed'?'fallido':'completado'},leased_until=null,updated_at=clock_timestamp() where id=${row.id} and status in ('iniciado','incierto','completado')`;
   });
   return readDemoDelivery(org,session,operation,false);
  }
 }
 return {deliveryId:row.id,messageId:row.message_id,providerMessageId:row.wa_message_id,status:['delivered','read'].includes(row.message_status)?'delivered':row.message_status==='failed'&&row.status==='completado'?'failed':({retenido:'pending',iniciado:'processing',incierto:'uncertain',completado:'accepted',fallido:'failed',cancelado:'cancelled'} as Record<string,string>)[row.status]??'uncertain'};
}
