import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth";
import { updateMetaObject } from "@/lib/meta";
import { toSafeWorkspace } from "@/lib/safe-workspace";
import { readWorkspace, updateWorkspace } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  return NextResponse.json(toSafeWorkspace(await readWorkspace(session.workspaceId)));
}

const updateSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("organization"),
    organizationId: z.string(),
    mode: z.enum(["observer", "copilot", "autonomous", "yolo"]).optional(),
    monthlyLimit: z.number().positive().optional(),
    targetRoas: z.number().min(0.5).max(50).optional(),
    resultValue: z.number().nonnegative().optional(),
  }),
  z.object({ action: z.literal("alert-read"), alertId: z.string() }),
  z.object({ action: z.literal("campaign-status"), campaignId: z.string(), status: z.enum(["ACTIVE", "PAUSED"]) }),
]);

export async function PATCH(request: Request) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const input = parsed.data;

  if (input.action === "campaign-status") {
    // Mirror manual toggles in Meta; otherwise the next sync would silently revert them.
    const { metaConnection, campaigns } = await readWorkspace(session.workspaceId);
    const campaign = campaigns.find((item) => item.id === input.campaignId);
    if (!campaign) return NextResponse.json({ error: "Campaña no encontrada" }, { status: 404 });
    if (campaign.status === "DRAFT") return NextResponse.json({ error: "Publica el borrador antes de activarlo" }, { status: 409 });
    if (metaConnection.status === "connected" && metaConnection.encryptedAccessToken) {
      try {
        await updateMetaObject(metaConnection.encryptedAccessToken, campaign.id, { status: input.status });
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Meta no aceptó el cambio" }, { status: 502 });
      }
    }
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
    if (input.action === "alert-read") current.alerts = current.alerts.map((alert) => alert.id === input.alertId ? { ...alert, read: true } : alert);
    if (input.action === "campaign-status") current.campaigns = current.campaigns.map((campaign) => campaign.id === input.campaignId ? { ...campaign, status: input.status, updatedAt: "Ahora" } : campaign);
    return current;
  });
  return NextResponse.json(toSafeWorkspace(workspace));
}
