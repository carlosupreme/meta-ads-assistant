import { NextResponse } from "next/server";
import { z } from "zod";
import { aiStatus, writeAdCopy } from "@/lib/ai/openai";
import { requestTrace } from "@/lib/ai/trace";
import { requireApiSession } from "@/lib/auth";
import { readWorkspace } from "@/lib/store";

export const maxDuration = 60;

// A 768 px JPEG from the browser is a few hundred KB; anything much larger is not a downscaled preview.
const MAX_IMAGE_DATA_URL = 2_000_000;

const schema = z.object({
  organizationId: z.string().min(1),
  offer: z.string().trim().min(3).max(120),
  objective: z.enum(["Ventas", "Prospectos", "Mensajes"]),
  customer: z.string().trim().max(300).default(""),
  details: z.string().trim().max(600).default(""),
  audience: z.string().trim().max(600).default(""),
  mediaKind: z.enum(["image", "video", "none"]),
  image: z.string().startsWith("data:image/jpeg;base64,").max(MAX_IMAGE_DATA_URL).optional(),
});

/** Three copy options for the ad being created, written with its photo or a frame of its video. */
export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Falta la oferta o la imagen no es válida." }, { status: 400 });
  const input = parsed.data;
  const workspace = await readWorkspace(session.workspaceId);
  const organization = workspace.organizations.find((item) => item.id === input.organizationId);
  if (!organization) return NextResponse.json({ error: "Negocio no encontrado." }, { status: 404 });
  const ai = aiStatus(workspace.aiModel);
  if (!ai.configured || !ai.model) return NextResponse.json({ error: ai.reason ?? "OpenAI no está configurado." }, { status: 503 });
  try {
    const variants = await writeAdCopy(ai.model, { business: organization.name, ...input }, requestTrace(request, session, organization));
    return NextResponse.json({ variants });
  } catch (error) {
    console.error("Ad copy failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "La IA no pudo escribir el texto." }, { status: 502 });
  }
}
