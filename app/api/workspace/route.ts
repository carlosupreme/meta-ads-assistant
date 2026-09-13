import { NextResponse } from "next/server";
import { z } from "zod";
import { listChatModels } from "@/lib/ai/openai";
import { requireApiSession } from "@/lib/auth";
import { toSafeWorkspace } from "@/lib/safe-workspace";
import { readWorkspace, updateWorkspace } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  return NextResponse.json(toSafeWorkspace(await readWorkspace(session.workspaceId)));
}

// Changes to campaigns and ads go through /api/control so they reach Meta and the change log.
const updateSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("organization"),
    organizationId: z.string(),
    mode: z.enum(["observer", "copilot", "autonomous", "yolo"]).optional(),
    monthlyLimit: z.number().positive().optional(),
    targetRoas: z.number().min(0.5).max(50).optional(),
    resultValue: z.number().nonnegative().optional(),
  }),
  z.object({ action: z.literal("ai-model"), model: z.string().min(1).max(100) }),
  z.object({ action: z.literal("branding"), agencyName: z.string().trim().min(2).max(60), accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
  z.object({ action: z.literal("report-settings"), organizationId: z.string(), clientEmails: z.array(z.email()).max(20), weeklyEmail: z.boolean() }),
  z.object({ action: z.literal("alert-read"), alertId: z.string() }),
]);

export async function PATCH(request: Request) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const input = parsed.data;

  if (input.action === "report-settings" && input.weeklyEmail && !input.clientEmails.length) {
    return NextResponse.json({ error: "Agrega al menos un correo para activar el resumen semanal." }, { status: 400 });
  }

  if (input.action === "ai-model") {
    // Only models this API key can actually call are accepted.
    const models = await listChatModels().catch(() => null);
    if (!models) return NextResponse.json({ error: "No fue posible consultar los modelos de OpenAI." }, { status: 502 });
    if (!models.includes(input.model)) return NextResponse.json({ error: "Ese modelo no está disponible para esta llave de OpenAI." }, { status: 400 });
  }

  const workspace = await updateWorkspace(session.workspaceId, (current) => {
    if (input.action === "organization") {
      current.organizations = current.organizations.map((organization) => organization.id === input.organizationId
        ? {
          ...organization,
          ...(input.mode && { mode: input.mode }),
          ...(input.monthlyLimit !== undefined && { monthlyLimit: input.monthlyLimit }),
          ...(input.targetRoas !== undefined && { targetRoas: input.targetRoas }),
          ...(input.resultValue !== undefined && { resultValue: input.resultValue }),
        }
        : organization);
    }
    if (input.action === "ai-model") current.aiModel = input.model;
    if (input.action === "branding") current.branding = { agencyName: input.agencyName, accentColor: input.accentColor };
    if (input.action === "report-settings") {
      current.organizations = current.organizations.map((organization) => organization.id === input.organizationId
        ? { ...organization, report: { ...organization.report, clientEmails: input.clientEmails, weeklyEmail: input.weeklyEmail } }
        : organization);
    }
    if (input.action === "alert-read") current.alerts = current.alerts.map((alert) => alert.id === input.alertId ? { ...alert, read: true } : alert);
    return current;
  });
  return NextResponse.json(toSafeWorkspace(workspace));
}
