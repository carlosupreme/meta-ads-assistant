import { NextResponse } from "next/server";
import { z } from "zod";
import { aiStatus, askPulso, buildAiContext } from "@/lib/ai/openai";
import { requireApiSession } from "@/lib/auth";
import { readWorkspace } from "@/lib/store";

const schema = z.object({ organizationId: z.string().min(1), question: z.string().trim().min(3).max(1200) });

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Escribe una pregunta de al menos tres caracteres." }, { status: 400 });
  try {
    const workspace = await readWorkspace(session.workspaceId);
    const status = aiStatus(workspace.aiModel);
    if (!status.configured || !status.model) return NextResponse.json({ error: status.reason }, { status: 503 });
    const organization = workspace.organizations.find((item) => item.id === parsed.data.organizationId);
    if (!organization) return NextResponse.json({ error: "Negocio no encontrado." }, { status: 404 });
    const answer = await askPulso(status.model, buildAiContext(
      organization,
      workspace.campaigns.filter((campaign) => campaign.organizationId === organization.id),
      workspace.ads.filter((ad) => ad.organizationId === organization.id),
    ), parsed.data.question);
    return NextResponse.json({ answer });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "La IA no pudo responder." }, { status: 502 });
  }
}
