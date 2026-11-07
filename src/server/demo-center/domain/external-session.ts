import { z } from "zod";
const id=z.string().min(1).max(128);
export const externalSessionRequest=z.object({contractVersion:z.literal(1),organizationId:id,conversationId:id,
 accountRef:id,channel:z.literal("whatsapp"),requestKey:id,
 identity:z.object({kind:z.enum(["phone","bsuid"]),value:id}).strict()}).strict();
export type ExternalSessionRequest=z.infer<typeof externalSessionRequest>;
