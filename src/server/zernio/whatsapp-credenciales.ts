import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { newId } from "@/lib/db/ids";

type Fila = typeof schema.zernioWhatsappCredentials.$inferSelect;
function descifrar(row: Fila) {
  return {
    organizationId: row.organizationId,
    accountRef: row.accountRef,
    token: decryptSecret({ cipher: row.tokenCipher, iv: row.tokenIv, tag: row.tokenTag }),
    secreto: decryptSecret({ cipher: row.secretCipher, iv: row.secretIv, tag: row.secretTag }),
  };
}
export async function obtenerZernioWhatsAppPorCuenta(accountRef: string) {
  const [row] = await getDb().select().from(schema.zernioWhatsappCredentials)
    .where(eq(schema.zernioWhatsappCredentials.accountRef, accountRef)).limit(1);
  return row ? descifrar(row) : null;
}
export async function obtenerZernioWhatsAppPorOrg(organizationId: string) {
  const [row] = await getDb().select().from(schema.zernioWhatsappCredentials)
    .where(eq(schema.zernioWhatsappCredentials.organizationId, organizationId)).limit(1);
  return row ? descifrar(row) : null;
}
export async function guardarZernioWhatsApp(input: {
  organizationId: string; accountRef: string; token: string; secreto: string;
}) {
  const token = encryptSecret(input.token);
  const secreto = encryptSecret(input.secreto);
  const values = {
    accountRef: input.accountRef, tokenCipher: token.cipher, tokenIv: token.iv, tokenTag: token.tag,
    secretCipher: secreto.cipher, secretIv: secreto.iv, secretTag: secreto.tag, updatedAt: new Date(),
  };
  await getDb().insert(schema.zernioWhatsappCredentials)
    .values({ id: newId("credentials"), organizationId: input.organizationId, ...values })
    .onConflictDoUpdate({ target: schema.zernioWhatsappCredentials.organizationId, set: values });
}
export async function eliminarZernioWhatsApp(organizationId: string) {
  await getDb().delete(schema.zernioWhatsappCredentials)
    .where(eq(schema.zernioWhatsappCredentials.organizationId, organizationId));
}
