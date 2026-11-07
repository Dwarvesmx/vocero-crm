import { z } from "zod";
const id=z.string().min(1).max(128);
/** Extensión aditiva del sobre comercial: no sustituye el sobre HMAC. */
export const demoScopeV1=z.object({kind:z.literal("demo"),organizationId:id,spaceId:id,sessionId:id,
 conversationId:id,authorizationId:id,routeGeneration:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),profileVersionId:id}).strict();
export const demoEnvelopeV1=z.object({contractVersion:z.literal(1),scope:demoScopeV1}).strict();
export type DemoScopeV1=z.infer<typeof demoScopeV1>;
export function validateDemoEnvelope(envelope:{organization:{id:string};conversation:{id:string};demo:unknown}){
 const demo=demoEnvelopeV1.parse(envelope.demo);
 if(demo.scope.organizationId!==envelope.organization.id || demo.scope.conversationId!==envelope.conversation.id)
  throw new Error("demo_scope_mismatch");
 return demo;
}
