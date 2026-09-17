import { NextResponse } from "next/server";
import { z } from "zod";
import { aiStatus, writeLeadForm } from "@/lib/ai/openai";
import { requestTrace } from "@/lib/ai/trace";
import { requireApiSession } from "@/lib/auth";
import { readWorkspace } from "@/lib/store";

export const maxDuration = 60;

const schema = z.object({
  organizationId: z.string().min(1),
  offer: z.string().trim().min(3).max(120),
  customer: z.string().trim().max(300).default(""),
  details: z.string().trim().max(600).default(""),
});

/** AI draft of an instant form's texts and qualifying questions; the owner reviews it before Meta creates it. */
export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Describe primero qué quieres promocionar." }, { status: 400 });
  const workspace = await readWorkspace(session.workspaceId);
  const organization = workspace.organizations.find((item) => item.id === parsed.data.organizationId);
  if (!organization) return NextResponse.json({ error: "Negocio no encontrado." }, { status: 404 });
  const ai = aiStatus(workspace.aiModel);
  if (!ai.configured || !ai.model) return NextResponse.json({ error: ai.reason ?? "OpenAI no está configurado." }, { status: 503 });
  try {
    const form = await writeLeadForm(ai.model, { business: organization.name, offer: parsed.data.offer, customer: parsed.data.customer, details: parsed.data.details }, requestTrace(request, session, organization));
    return NextResponse.json({ form });
  } catch (error) {
    console.error("Lead form suggestion failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "La IA no pudo sugerir el formulario." }, { status: 502 });
  }
}
