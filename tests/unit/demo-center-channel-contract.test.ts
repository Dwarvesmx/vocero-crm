import {it,expect} from "vitest";
import {validateDemoEnvelope} from "@/server/demo-center/domain/channel-contract";
it("valida el ámbito v1 del sobre firmado sin aceptar referencias cruzadas",()=>{
 const envelope={organization:{id:"org_a"},conversation:{id:"cv_a"},demo:{contractVersion:1,scope:{kind:"demo",organizationId:"org_a",spaceId:"space_a",sessionId:"session_a",conversationId:"cv_a",authorizationId:"auth_a",routeGeneration:1,profileVersionId:"profile_a"}}};
 expect(validateDemoEnvelope(envelope)).toEqual(envelope.demo);
 expect(()=>validateDemoEnvelope({...envelope,organization:{id:"org_b"}})).toThrow();
 expect(()=>validateDemoEnvelope({...envelope,conversation:{id:"cv_b"}})).toThrow();
 expect(()=>validateDemoEnvelope({...envelope,demo:{...envelope.demo,contractVersion:2}})).toThrow();
 expect(()=>validateDemoEnvelope({...envelope,demo:{...envelope.demo,extra:true}})).toThrow();
});
