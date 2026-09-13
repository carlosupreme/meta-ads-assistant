import { NextResponse } from "next/server";
import { z } from "zod";
import { buildAiContext, getAiProvider } from "@/lib/ai/provider";
import { readWorkspace } from "@/lib/store";

const schema = z.object({ organizationId: z.string().min(1), question: z.string().trim().min(3).max(1200) });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Escribe una pregunta de al menos tres caracteres." }, { status: 400 });
  const provider = getAiProvider();
  const status = provider.status();
  if (!status.configured) return NextResponse.json({ error: status.reason || "No hay proveedor de IA configurado." }, { status: 503 });
  try {
    const workspace = await readWorkspace();
    const organization = workspace.organizations.find((item) => item.id === parsed.data.organizationId);
    if (!organization) return NextResponse.json({ error: "Negocio no encontrado." }, { status: 404 });
    const answer = await provider.ask(buildAiContext(
      organization,
      workspace.campaigns.filter((campaign) => campaign.organizationId === organization.id),
      workspace.ads.filter((ad) => ad.organizationId === organization.id),
    ), parsed.data.question);
    return NextResponse.json({ answer, provider: status });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "La IA no pudo responder." }, { status: 502 });
  }
}
