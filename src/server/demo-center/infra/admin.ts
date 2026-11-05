import { createHmac, randomUUID } from "node:crypto";
import { desc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import type { AdminActor, AdminCommand, GlobalCommand } from "../domain/contracts";

import { encryptSecret } from "@/lib/crypto";
import { getEnv } from "@/lib/env";

const { demoSpace, demoProfileVersion, demoAdminAudit, demoAuthorization, demoLimits } = schema;
const authorizationScope = (org: string, id: string) =>
  scoped(demoAuthorization.organizationId, org, eq(demoAuthorization.spaceId, id));
const limitsScope = (org: string, id: string) =>
  scoped(demoLimits.organizationId, org, eq(demoLimits.spaceId, id));
const scope = (org: string, id: string) => scoped(demoSpace.organizationId, org, eq(demoSpace.id, id));

export async function listarEspacios(actor: AdminActor) {
  return getDb().select().from(demoSpace)
    .where(scoped(demoSpace.organizationId, actor.organizationId)).orderBy(demoSpace.name);
}

export async function consultarEspacio(actor: AdminActor, id: string) {
  const db = getDb();
  const [space] = await db.select().from(demoSpace).where(scope(actor.organizationId, id));
  if (!space) return null;
  const profileScope = scoped(demoProfileVersion.organizationId, actor.organizationId, eq(demoProfileVersion.spaceId, id));
  const [profiles, audit, authorizations, limits] = await Promise.all([
    db.select().from(demoProfileVersion).where(profileScope).orderBy(desc(demoProfileVersion.version)).limit(25),
    db.select().from(demoAdminAudit)
      .where(scoped(demoAdminAudit.organizationId, actor.organizationId, eq(demoAdminAudit.spaceId, id)))
      .orderBy(desc(demoAdminAudit.timestamp)).limit(50),
    db.select({ id: demoAuthorization.id, suffix: demoAuthorization.phoneSuffix,
      state: demoAuthorization.state, expiresAt: demoAuthorization.expiresAt,
      createdBy: demoAuthorization.createdBy }).from(demoAuthorization)
      .where(authorizationScope(actor.organizationId, id)).orderBy(desc(demoAuthorization.createdAt)),
    db.select().from(demoLimits).where(limitsScope(actor.organizationId, id)),
  ]);
  const policy = limits[0];
  return { space, profiles, audit, authorizations, limits: policy ? {
    ...policy, budgetMicroUsd: String(policy.budgetMicroUsd),
    sessionBudgetMicroUsd: policy.sessionBudgetMicroUsd?.toString() ?? null,
  } : null };
}

export async function guardarEspacio(actor: AdminActor, command: AdminCommand) {
  return getDb().transaction(async tx => {
    const { organizationId, userId } = actor;
    const id = command.action === "create" ? randomUUID() : command.id;
    let targetId = id;
    let priorVersion: number | null = null;
    let newVersion = 1;
    if (command.action === "create") {
      await tx.insert(demoSpace).values({ ...command.space, id, organizationId });
    } else {
      const [space] = await tx.select().from(demoSpace).where(scope(organizationId, id)).for("update");
      if (!space) return { outcome: "missing" } as const;
      if (space.generation !== command.expectedGeneration) return { outcome: "conflict" } as const;
      priorVersion = space.generation;
      newVersion = space.generation + 1;
      let patch: Partial<typeof demoSpace.$inferInsert>;
      if (command.action === "publishProfile") {
        const [last] = await tx.select({ version: demoProfileVersion.version }).from(demoProfileVersion)
          .where(scoped(demoProfileVersion.organizationId, organizationId, eq(demoProfileVersion.spaceId, id)))
          .orderBy(desc(demoProfileVersion.version)).limit(1);
        const profileId = randomUUID();
        await tx.insert(demoProfileVersion).values({
          ...command.profile, id: profileId, organizationId, spaceId: id, createdBy: userId,
          version: (last?.version ?? 0) + 1,
        });
        patch = { currentProfileVersionId: profileId };
      } else if (command.action === "status") {
        if (command.status === "active" && !space.currentProfileVersionId) return { outcome: "profile_required" } as const;
        patch = { status: command.status };
      } else if (command.action === "authorize") {
        const expiresAt = command.expiresAt ? new Date(command.expiresAt) : null;
        if (expiresAt && expiresAt <= new Date()) return { outcome: "expired" } as const;
        const phoneLookup = createHmac("sha256", Buffer.from(getEnv().ENCRYPTION_KEY, "base64"))
          .update(JSON.stringify(["demo-phone:v1", organizationId, command.phone])).digest("hex");
        targetId = randomUUID();
        const [saved] = await tx.insert(demoAuthorization).values({
          id: targetId, organizationId, spaceId: id, createdBy: userId, expiresAt,
          canonicalPhone: encryptSecret(command.phone), phoneLookup, phoneSuffix: command.phone.slice(-4),
        }).onConflictDoNothing().returning({ id: demoAuthorization.id });
        if (!saved) return { outcome: "conflict" } as const;
        patch = {};
      } else if (command.action === "revoke") {
        const [authorization] = await tx.select().from(demoAuthorization).where(scoped(
          demoAuthorization.organizationId, organizationId, eq(demoAuthorization.spaceId, id),
          eq(demoAuthorization.id, command.authorizationId), eq(demoAuthorization.state, "active")));
        if (!authorization) return { outcome: "missing" } as const;
        targetId = authorization.id;
        await tx.update(demoAuthorization).set({ state: "revoked", version: authorization.version + 1 })
          .where(scoped(demoAuthorization.organizationId, organizationId,
            eq(demoAuthorization.spaceId, id), eq(demoAuthorization.id, authorization.id)));
        patch = {};
      } else if (command.action === "limits") {
        const [previous] = await tx.select().from(demoLimits).where(limitsScope(organizationId, id));
        const values = {
          ...command.limits, budgetMicroUsd: BigInt(command.limits.budgetMicroUsd),
          sessionBudgetMicroUsd: command.limits.sessionBudgetMicroUsd === null ? null : BigInt(command.limits.sessionBudgetMicroUsd),
          windowStart: new Date(command.limits.windowStart), windowEnd: new Date(command.limits.windowEnd),
        };
        targetId = previous?.id ?? randomUUID();
        if (previous) await tx.update(demoLimits).set({ ...values, version: previous.version + 1 }).where(limitsScope(organizationId, id));
        else await tx.insert(demoLimits).values({ ...values, id: targetId, organizationId, spaceId: id });
        patch = {};
      } else {
        patch = command.space;
      }
      await tx.update(demoSpace).set({ ...patch, generation: newVersion, updatedAt: new Date() })
        .where(scope(organizationId, id));
    }
    const requestId = randomUUID();
    await tx.insert(demoAdminAudit).values({
      id: requestId, requestId, organizationId, spaceId: id, actorUserId: userId,
      action: command.action, targetId, priorVersion, newVersion,
      reasonCode: "admin_configuration", result: "success",
    });
    return { outcome: "saved", id, generation: newVersion } as const;
  });
}

const globalScope = (org: string) => scoped(demoLimits.organizationId, org, isNull(demoLimits.spaceId));
export async function consultarPoliticaGlobal(actor: AdminActor) {
  const [policy] = await getDb().select().from(demoLimits).where(globalScope(actor.organizationId));
  return policy ? { ...policy, budgetMicroUsd: String(policy.budgetMicroUsd), sessionBudgetMicroUsd: null } : null;
}

export async function consultarExcepciones(actor: AdminActor, spaceId?: string) {
  const table = schema.demoLimitException;
  const rows = await getDb().select().from(table).where(scoped(table.organizationId, actor.organizationId,
    spaceId ? eq(table.spaceId, spaceId) : isNull(table.spaceId))).orderBy(desc(table.createdAt)).limit(25);
  return rows.map(row => ({ ...row, extraBudgetMicroUsd: String(row.extraBudgetMicroUsd) }));
}

export async function guardarPoliticaGlobal(actor: AdminActor, command: GlobalCommand) {
  return getDb().transaction(async tx => {
    const org = actor.organizationId;
    let targetId: string = randomUUID();
    let priorVersion: number | null = null;
    let newVersion: number | null = null;
    const spaceId = command.action === "budgetException" ? command.spaceId : null;
    if (command.action === "globalLimits") {
      // La organización es la fila estable aun antes de insertar la primera política.
      await tx.select({ id: schema.organization.id }).from(schema.organization).where(eq(schema.organization.id, org)).for("update");
      const [previous] = await tx.select().from(demoLimits).where(globalScope(org));
      priorVersion = previous?.version ?? 0;
      if (priorVersion !== command.expectedVersion) return { outcome: "conflict" } as const;
      newVersion = priorVersion + 1;
      const values = { ...command.limits, budgetMicroUsd: BigInt(command.limits.budgetMicroUsd),
        sessionBudgetMicroUsd: null, version: newVersion, windowStart: new Date(command.limits.windowStart),
        windowEnd: new Date(command.limits.windowEnd) };
      if (previous) {
        targetId = previous.id;
        await tx.update(demoLimits).set(values).where(globalScope(org));
      } else await tx.insert(demoLimits).values({ ...values, id: targetId, organizationId: org });
    } else {
      if (spaceId) {
        const [exists] = await tx.select({ id: demoSpace.id }).from(demoSpace).where(scope(org, spaceId));
        if (!exists) return { outcome: "missing" } as const;
      }
      const expiresAt = new Date(command.expiresAt);
      if (expiresAt <= new Date()) return { outcome: "expired" } as const;
      await tx.insert(schema.demoLimitException).values({ id: targetId, organizationId: org, spaceId,
        extraBudgetMicroUsd: BigInt(command.extraBudgetMicroUsd), expiresAt, createdBy: actor.userId, reason: command.reason });
    }
    const requestId = randomUUID();
    await tx.insert(demoAdminAudit).values({ id: requestId, requestId, organizationId: org, spaceId,
      actorUserId: actor.userId, action: command.action, targetId, priorVersion, newVersion,
      reasonCode: command.action === "budgetException" ? command.reason : "admin_configuration", result: "success" });
    return { outcome: "saved", id: targetId } as const;
  });
}
