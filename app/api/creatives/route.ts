import { NextResponse } from "next/server";
import { z } from "zod";
import { executeAction } from "@/lib/agent-engine";
import { requireApiSession } from "@/lib/auth";
import { uploadAdImageWithToken } from "@/lib/meta";
import { checkGuardrails, recordAction } from "@/lib/optimizer";
import { toSafeWorkspace } from "@/lib/safe-workspace";
import { readWorkspace, updateWorkspace } from "@/lib/store";
import type { AgentAction } from "@/lib/types";

// Vercel rejects request bodies above 4.5 MB.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png"];

const schema = z.object({
  sourceAdId: z.string().min(1),
  headline: z.string().trim().min(3).max(60),
  primaryText: z.string().trim().min(10).max(500),
});

/** Publishes a new ad in the source ad's set, reusing its destination and, unless replaced, its image. */
export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "No se recibieron los datos del anuncio." }, { status: 400 });
  }
  const fields = Object.fromEntries([...form.entries()].filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  const parsed = schema.safeParse(fields);
  if (!parsed.success) return NextResponse.json({ error: "El título debe tener de 3 a 60 caracteres y el texto de 10 a 500." }, { status: 400 });
  const upload = form.get("image");
  const image = upload instanceof File && upload.size > 0 ? upload : null;
  if (image && (!IMAGE_TYPES.includes(image.type) || image.size > MAX_IMAGE_BYTES)) {
    return NextResponse.json({ error: "La imagen debe ser JPG o PNG de hasta 4 MB." }, { status: 400 });
  }

  const now = new Date();
  const workspace = await readWorkspace(session.workspaceId);
  const source = workspace.ads.find((ad) => ad.id === parsed.data.sourceAdId);
  const campaign = workspace.campaigns.find((item) => item.id === source?.campaignId);
  const organization = workspace.organizations.find((item) => item.id === campaign?.organizationId);
  if (!source || !campaign || !organization) return NextResponse.json({ error: "Anuncio base no encontrado." }, { status: 404 });
  if (campaign.status === "DRAFT") return NextResponse.json({ error: "Publica el borrador antes de agregarle anuncios." }, { status: 409 });

  let imageHash: string | undefined;
  const { status, encryptedAccessToken } = workspace.metaConnection;
  if (image && status === "connected") {
    if (!encryptedAccessToken) return NextResponse.json({ error: "La conexión con Meta no tiene un token válido" }, { status: 409 });
    try {
      imageHash = await uploadAdImageWithToken(encryptedAccessToken, organization.adAccountId, Buffer.from(await image.arrayBuffer()).toString("base64"));
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Meta no aceptó la imagen" }, { status: 502 });
    }
  }

  const action: AgentAction = {
    id: `action-${globalThis.crypto.randomUUID()}`,
    organizationId: organization.id,
    agent: "Creativos",
    type: "create_ad",
    campaignId: campaign.id,
    campaignName: campaign.name,
    adName: source.name,
    variant: { adSetId: source.adSetId, sourceAdId: source.id, headline: parsed.data.headline, primaryText: parsed.data.primaryText, ...(imageHash && { imageHash }) },
    reason: imageHash ? "Anuncio creado manualmente con texto e imagen nuevos." : "Anuncio creado manualmente con texto renovado.",
    impact: "Nuevo anuncio en el mismo conjunto",
    source: "user",
    trigger: "manual",
    status: "executing",
    createdAt: now.toISOString(),
  };
  const check = checkGuardrails(action, { organization, campaigns: workspace.campaigns, ads: workspace.ads, budgetChanges: workspace.budgetChanges, now });
  const resolved: AgentAction = check.allowed
    ? await executeAction(workspace, action, now)
    : { ...action, status: "blocked", guardrail: check.reason, resolvedAt: now.toISOString() };
  const next = await updateWorkspace(session.workspaceId, (current) => recordAction(current, resolved, now));

  const message = resolved.status === "executed" ? "Anuncio nuevo publicado."
    : resolved.status === "blocked" ? `No se aplicó: ${resolved.guardrail}`
      : `Meta rechazó el anuncio: ${resolved.error}`;
  const code = resolved.status === "executed" ? 200 : resolved.status === "blocked" ? 409 : 502;
  return NextResponse.json({ status: resolved.status, message, workspace: toSafeWorkspace(next) }, { status: code });
}
