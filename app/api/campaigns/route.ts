import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth";
import { createMetaSalesCampaign } from "@/lib/meta";
import { readWorkspace, updateWorkspace } from "@/lib/store";

const campaignSchema = z.object({
  organizationId: z.string(),
  offer: z.string().min(3),
  objective: z.enum(["Ventas", "Prospectos", "Mensajes"]),
  destination: z.string().min(3),
  dailyBudget: z.number().min(100),
  location: z.string().min(2),
  audience: z.string().optional(),
  publish: z.boolean().default(false),
});

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const parsed = campaignSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Revisa los datos de la campaña" }, { status: 400 });
  const input = parsed.data;
  const current = await readWorkspace(session.workspaceId);
  const selectedOrganization = current.organizations.find((item) => item.id === input.organizationId);
  if (!selectedOrganization) return NextResponse.json({ error: "Negocio no encontrado" }, { status: 404 });
  let createdId = `cmp-${Date.now()}`;
  let createdStatus: "ACTIVE" | "PAUSED" | "DRAFT" = input.publish && current.metaConnection.status === "demo" ? "ACTIVE" : "DRAFT";
  let message = createdStatus === "ACTIVE" ? "Campaña demo lanzada." : "Borrador y creativo generados.";

  if (input.publish && current.metaConnection.status === "connected") {
    if (input.objective !== "Ventas") {
      message = "El borrador quedó listo. Leads y mensajes requieren elegir formulario o WhatsApp antes de publicarse.";
    } else if (!current.metaConnection.encryptedAccessToken) {
      return NextResponse.json({ error: "La conexión con Meta no tiene un token válido" }, { status: 409 });
    } else {
      try {
        const metaCampaign = await createMetaSalesCampaign(current.metaConnection.encryptedAccessToken, selectedOrganization, input);
        createdId = metaCampaign.campaignId;
        createdStatus = metaCampaign.status;
        message = "Campaña publicada en Facebook e Instagram.";
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Meta no pudo crear la campaña" }, { status: 502 });
      }
    }
  }
  const workspace = await updateWorkspace(session.workspaceId, (current) => {
    const organization = current.organizations.find((item) => item.id === input.organizationId);
    if (!organization) throw new Error("Negocio no encontrado");
    const id = createdId;
    const status = createdStatus;
    current.campaigns = [{
      id,
      organizationId: input.organizationId,
      name: `${input.objective} · ${input.offer}`,
      status,
      objective: input.objective,
      channel: "Facebook + Instagram",
      spend: 0,
      results: 0,
      costPerResult: 0,
      revenue: 0,
      roas: 0,
      trend: 0,
      dailyBudget: input.dailyBudget,
      updatedAt: "Ahora",
    }, ...current.campaigns];
    current.creatives = [{
      id: `cr-${Date.now()}`,
      organizationId: input.organizationId,
      title: input.offer,
      headline: `Descubre ${input.offer}`,
      primaryText: `Una nueva forma de obtener ${input.offer.toLowerCase()}. Conoce todos los detalles hoy.`,
      status: status === "ACTIVE" ? "Probando" : "Borrador",
      format: "Imagen",
      score: 84,
      palette: [organization.color, "#12131a", "#f4f1ec"],
    }, ...current.creatives];
    current.activities = [{
      id: `act-${Date.now()}`,
      organizationId: input.organizationId,
      agent: "Estratega",
      title: status === "ACTIVE" ? "Lancé una campaña completa" : "Preparé una campaña completa",
      detail: `Creé estructura, audiencia para ${input.location}, presupuesto y una primera variante creativa para ${input.offer}.`,
      impact: status === "ACTIVE" ? "Campaña en aprendizaje" : "Lista para revisar",
      kind: "action",
      createdAt: "Ahora",
    }, ...current.activities];
    return current;
  });
  return NextResponse.json({ success: true, campaign: workspace.campaigns[0], message });
}
