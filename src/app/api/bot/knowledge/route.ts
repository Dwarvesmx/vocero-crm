import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { buscarDocumentos } from "@/server/kb/documents";
export const dynamic = "force-dynamic";
export async function POST(req: Request) {
    const denied = requireBotKey(req);
    if (denied)
        return denied;
    const org = await resolveInstanceOrg();
    if (!org)
        return apiError(409, "no_org", "Sin organización.");
    const body = await parseBody(req, z.object({ query: z.string().trim().min(1).max(500) }));
    if (!body.ok)
        return body.response;
    return Response.json({ chunks: await buscarDocumentos(org, body.data.query) });
}
