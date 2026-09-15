import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth";
import { AD_SET_NAME, createMetaCampaign } from "@/lib/meta";
import { readWorkspace, updateWorkspace } from "@/lib/store";
import { pageFields } from "@/lib/workspace";
import type { Campaign } from "@/lib/types";

// Vercel rejects request bodies above 4.5 MB, so the image must stay below that with the other fields.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png"];

const campaignSchema = z.object({
  organizationId: z.string().min(1),
  offer: z.string().trim().min(3).max(120),
  objective: z.enum(["Ventas", "Prospectos", "Mensajes"]),
  headline: z.string().trim().min(3).max(60),
  primaryText: z.string().trim().min(10).max(500),
  destination: z.string().trim().max(500).optional(),
  leadFormId: z.string().trim().max(40).optional(),
  messagingApp: z.enum(["WHATSAPP", "MESSENGER"]).optional(),
  pageId: z.string().trim().max(40).optional(),
  dailyBudget: z.coerce.number().min(100),
  publish: z.enum(["true", "false"]).transform((value) => value === "true"),
});

const DESTINATION_LABEL: Record<"Ventas" | "Prospectos" | "Mensajes", string> = {
  Ventas: "tu sitio web",
  Prospectos: "un formulario instantáneo",
  Mensajes: "conversaciones",
};

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "No se recibieron los datos de la campaña." }, { status: 400 });
  }
  // Empty inputs arrive as "", which should mean "not provided".
  const fields = Object.fromEntries([...form.entries()].filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== ""));
  const parsed = campaignSchema.safeParse(fields);
  if (!parsed.success) return NextResponse.json({ error: "Revisa los datos de la campaña: oferta, título (3–60 caracteres), texto (10–500) y presupuesto." }, { status: 400 });
  const input = parsed.data;
  const upload = form.get("image");
  const image = upload instanceof File && upload.size > 0 ? upload : null;
  if (image && (!IMAGE_TYPES.includes(image.type) || image.size > MAX_IMAGE_BYTES)) {
    return NextResponse.json({ error: "La imagen debe ser JPG o PNG de hasta 4 MB." }, { status: 400 });
  }

  const current = await readWorkspace(session.workspaceId);
  const organization = current.organizations.find((item) => item.id === input.organizationId);
  if (!organization) return NextResponse.json({ error: "Negocio no encontrado" }, { status: 404 });
  // Any Page the profile manages can publish for this ad account; the business default is used otherwise.
  const page = input.pageId ? current.pages?.find((item) => item.id === input.pageId) : undefined;
  if (input.pageId && !page) return NextResponse.json({ error: "Esa página no está disponible para tu perfil de Meta. Sincroniza e intenta de nuevo." }, { status: 400 });
  const publisher = page ? { ...organization, ...pageFields(page) } : organization;

  const connected = current.metaConnection.status === "connected";
  let campaignId = `cmp-${Date.now()}`;
  let adSetId: string | undefined;
  let status: Campaign["status"] = input.publish ? "ACTIVE" : "DRAFT";
  let message = input.publish ? "Campaña demo lanzada." : "Borrador y creativo generados.";

  if (connected) {
    // With Meta connected every campaign is real: publish only decides whether it starts active or paused.
    const token = current.metaConnection.encryptedAccessToken;
    if (!token) return NextResponse.json({ error: "La conexión con Meta no tiene un token válido" }, { status: 409 });
    if (!image) return NextResponse.json({ error: "Sube la imagen del anuncio para crearlo en Meta." }, { status: 400 });
    try {
      const created = await createMetaCampaign(token, publisher, {
        ...input,
        image: { base64: Buffer.from(await image.arrayBuffer()).toString("base64") },
      });
      campaignId = created.campaignId;
      adSetId = created.adSetId;
      status = created.status;
      message = created.status === "ACTIVE"
        ? "Campaña publicada en Facebook e Instagram."
        : "Campaña creada en Meta en pausa. Actívala cuando estés listo.";
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Meta no pudo crear la campaña" }, { status: 502 });
    }
  }

  const workspace = await updateWorkspace(session.workspaceId, (latest) => {
    const owner = latest.organizations.find((item) => item.id === input.organizationId);
    if (!owner) throw new Error("Negocio no encontrado");
    const adSetStatus = status === "ACTIVE" ? "ACTIVE" : "PAUSED";
    const channelLabel = input.objective === "Mensajes" ? (input.messagingApp === "MESSENGER" ? "Messenger" : "WhatsApp") : input.objective;
    latest.campaigns = [{
      id: campaignId,
      organizationId: input.organizationId,
      name: `${channelLabel} · ${input.offer}`,
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
      ...(publisher.pageId && { pageIds: [publisher.pageId] }),
      // Meta holds the budget on the ad set; recording it lets the agents manage it before the next sync.
      ...(adSetId && { budgetLevel: "adset" as const, adSets: [{ id: adSetId, name: AD_SET_NAME, status: adSetStatus, dailyBudget: input.dailyBudget }] }),
      updatedAt: "Ahora",
    }, ...latest.campaigns];
    latest.creatives = [{
      id: `cr-${Date.now()}`,
      organizationId: input.organizationId,
      title: input.offer,
      headline: input.headline,
      primaryText: input.primaryText,
      status: status === "ACTIVE" ? "Probando" : "Borrador",
      format: "Imagen",
      score: 84,
      palette: [owner.color, "#12131a", "#f4f1ec"],
    }, ...latest.creatives];
    latest.activities = [{
      id: `act-${Date.now()}`,
      organizationId: input.organizationId,
      agent: "Estratega",
      title: status === "ACTIVE" ? "Lancé una campaña completa" : "Preparé una campaña completa",
      detail: `Creé campaña, audiencia para México, presupuesto de ${input.dailyBudget} MXN diarios y un anuncio con imagen que lleva a ${DESTINATION_LABEL[input.objective]} para ${input.offer}.`,
      impact: status === "ACTIVE" ? "Campaña en aprendizaje" : connected ? "En pausa en Meta, lista para activar" : "Lista para revisar",
      kind: "action",
      createdAt: new Date().toISOString(),
    }, ...latest.activities];
    return latest;
  });
  return NextResponse.json({ success: true, campaign: workspace.campaigns[0], message });
}
