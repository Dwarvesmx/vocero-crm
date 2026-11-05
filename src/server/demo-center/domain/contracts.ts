import { z } from "zod";

const name = z.string().trim().min(1).max(120);
export const spaceInput = z.object({
  name, commercialName: name, sector: name,
  description: z.string().trim().max(2000),
  visualIdentity: z.object({ color: z.string().regex(/^#[a-f0-9]{6}$/i) }).strict(),
}).strict();

const profileInput = z.object({
  name, tone: z.string().trim().max(500),
  instructions: z.string().trim().min(1).max(12000),
  escalationRules: z.string().trim().max(3000),
  greeting: z.string().trim().max(1000), role: name,
  tools: z.tuple([]),
}).strict();

const revision = { id: z.string().min(1).max(128), expectedGeneration: z.number().int().positive() };
const counter = z.number().int().min(0).max(2147483647);
const money = z.string().regex(/^\d{1,18}$/);
export const limitsInput = z.object({
  maxDurationSeconds: counter, maxIdleSeconds: counter, maxConcurrentSessions: counter,
  maxSessionsStarted: counter, maxInboundMessages: counter, maxAssistantResponses: counter,
  maxProviderCalls: counter, budgetMicroUsd: money, sessionBudgetMicroUsd: money.nullable(),
  windowStart: z.string().datetime(), windowEnd: z.string().datetime(), enabled: z.boolean(),
}).strict().refine(v => Date.parse(v.windowEnd) > Date.parse(v.windowStart) && v.maxIdleSeconds <= v.maxDurationSeconds,
  "Revisa la ventana y los límites de tiempo.");
export const adminCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), space: spaceInput }).strict(),
  z.object({ action: z.literal("edit"), ...revision, space: spaceInput }).strict(),
  z.object({ action: z.literal("status"), ...revision, status: z.enum(["active", "disabled"]) }).strict(),
  z.object({ action: z.literal("publishProfile"), ...revision, profile: profileInput }).strict(),
  z.object({ action: z.literal("authorize"), ...revision, phone: z.string().trim().regex(/^\+[1-9][0-9]{7,14}$/),
    expiresAt: z.string().datetime().nullable() }).strict(),
  z.object({ action: z.literal("revoke"), ...revision, authorizationId: z.string().min(1).max(128) }).strict(),
  z.object({ action: z.literal("limits"), ...revision, limits: limitsInput }).strict(),

]);
export type AdminCommand = z.infer<typeof adminCommand>;
export type AdminActor = { organizationId: string; userId: string };

export const globalCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("globalLimits"), expectedVersion: z.number().int().min(0), limits: limitsInput }).strict(),
  z.object({ action: z.literal("budgetException"), spaceId: revision.id.nullable(),
    extraBudgetMicroUsd: money.refine(v => BigInt(v) > 0n), expiresAt: z.string().datetime(),
    reason: z.enum(["demonstration", "operational_review"]) }).strict(),
]);
export type GlobalCommand = z.infer<typeof globalCommand>;

// Contrato reservado. Fase 1 no produce despachos ni respuestas con este ámbito.
export type DemoScopeV1 = Readonly<{
  kind: "demo";
  organizationId: string;
  spaceId: string;
  sessionId: string;
  conversationId: string;
  authorizationId: string;
  routeGeneration: number;
  profileVersionId: string;
}>;

export type DemoDispatchV1 = Readonly<{
  contractVersion: 1;
  dispatchId: string;
  scope: DemoScopeV1;
  expiresAt: string;
  visitor: { contactId: string; channel: "whatsapp"; identity: string };
  messageIds: readonly string[];
  messages: ReadonlyArray<{ id: string; text: string }>;
}>;

export type DemoResponseV1 = Readonly<{
  contractVersion: 1;
  dispatchId: string;
  responseId: string;
  scope: DemoScopeV1;
  text: string;
  handoffReason?: string;
}>;
