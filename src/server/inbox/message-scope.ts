import {sql} from "drizzle-orm";
import {schema} from "@/lib/db";
/** NULL es compatibilidad de lectura; nunca reclasifica filas persistidas. */
export const commercialMessageScope=()=>sql`coalesce(${schema.message.scopeKind},'commercial') = 'commercial'`;
export const isCommercialScope=(kind:unknown)=>kind==null||kind==='commercial';

export const commercialConversationScope=()=>sql`(not exists(select 1 from message dm where dm.organization_id=${schema.conversation.organizationId} and dm.conversation_id=${schema.conversation.id} and coalesce(dm.scope_kind,'commercial')<>'commercial') or exists(select 1 from message cm where cm.organization_id=${schema.conversation.organizationId} and cm.conversation_id=${schema.conversation.id} and coalesce(cm.scope_kind,'commercial')='commercial'))`;
