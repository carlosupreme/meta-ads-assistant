import { NextResponse } from "next/server";
import { z } from "zod";
import { aiStatus, writeAdVariants } from "@/lib/ai/openai";
import { requireApiSession } from "@/lib/auth";
import { readWorkspace } from "@/lib/store";

const schema = z.object({ adId: z.string().min(1) });

/** Three copy variants for an ad, written with the workspace's OpenAI model. */
export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  const workspace = await readWorkspace(session.workspaceId);
  const status = aiStatus(workspace.aiModel);
  if (!status.configured || !status.model) return NextResponse.json({ error: status.reason }, { status: 503 });
  const ad = workspace.ads.find((item) => item.id === parsed.data.adId);
  const campaign = workspace.campaigns.find((item) => item.id === ad?.campaignId);
  const organization = workspace.organizations.find((item) => item.id === campaign?.organizationId);
  if (!ad || !campaign || !organization) return NextResponse.json({ error: "Anuncio no encontrado." }, { status: 404 });
  if (!ad.creative?.headline && !ad.creative?.primaryText) {
    return NextResponse.json({ error: "Este anuncio aún no tiene texto sincronizado. Sincroniza Meta e intenta de nuevo." }, { status: 409 });
  }
  try {
    const variants = await writeAdVariants(status.model, {
      business: organization.name,
      objective: organization.objective,
      campaign: campaign.name,
      headline: ad.creative.headline,
      primaryText: ad.creative.primaryText,
      ctr: ad.ctr,
      frequency: ad.frequency,
      results: ad.results,
    });
    return NextResponse.json({ variants });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "OpenAI no pudo escribir las variantes." }, { status: 502 });
  }
}
