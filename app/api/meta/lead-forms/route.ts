import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth";
import { leadFormProblem, MAX_CUSTOM_QUESTIONS } from "@/lib/lead-forms";
import { createLeadForm, listLeadForms } from "@/lib/meta";
import { readWorkspace, updateWorkspace } from "@/lib/store";
import type { WorkspaceData } from "@/lib/types";

export const dynamic = "force-dynamic";

/** The creator may publish with any Page the profile manages; unknown ids fall back to the business default. */
function resolvePageId(workspace: WorkspaceData, organizationPageId: string | undefined, requested: string | null | undefined): string | undefined {
  return requested && workspace.pages?.some((page) => page.id === requested) ? requested : organizationPageId;
}

export async function GET(request: Request) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const params = new URL(request.url).searchParams;
  const workspace = await readWorkspace(session.workspaceId);
  const organization = workspace.organizations.find((item) => item.id === params.get("organizationId"));
  if (!organization) return NextResponse.json({ error: "Negocio no encontrado." }, { status: 404 });
  const { status, encryptedAccessToken } = workspace.metaConnection;
  if (status !== "connected" || !encryptedAccessToken) {
    return NextResponse.json({ forms: [], reason: "Conecta Meta para usar tus formularios instantáneos." });
  }
  const pageId = resolvePageId(workspace, organization.pageId, params.get("pageId"));
  if (!pageId) {
    return NextResponse.json({ forms: [], reason: "Este negocio no tiene una Página de Facebook vinculada." });
  }
  try {
    return NextResponse.json({ forms: await listLeadForms(encryptedAccessToken, pageId) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Meta no devolvió los formularios.";
    return NextResponse.json({ forms: [], reason }, { status: 502 });
  }
}

const createSchema = z.object({
  organizationId: z.string().min(1),
  pageId: z.string().max(40).optional(),
  name: z.string().trim().min(3).max(100),
  headline: z.string().trim().min(3).max(60),
  description: z.string().trim().max(300).default(""),
  fields: z.object({ fullName: z.boolean(), email: z.boolean(), phone: z.boolean(), city: z.boolean() }),
  customQuestions: z.array(z.object({
    label: z.string().trim().min(3).max(120),
    options: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
  })).max(MAX_CUSTOM_QUESTIONS).default([]),
  higherIntent: z.boolean().default(false),
  privacyPolicyUrl: z.string().trim().max(500),
  privacyLinkText: z.string().trim().max(70).optional(),
  thankYouTitle: z.string().trim().min(3).max(60),
  thankYouBody: z.string().trim().min(3).max(300),
  websiteUrl: z.string().trim().max(500).optional(),
});

/** Creates an instant form on the Page and remembers the privacy policy for the next one. */
export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const parsed = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Revisa el formulario: nombre, título, preguntas y agradecimiento." }, { status: 400 });
  const { organizationId, pageId: requestedPageId, ...input } = parsed.data;
  const problem = leadFormProblem(input);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const workspace = await readWorkspace(session.workspaceId);
  const organization = workspace.organizations.find((item) => item.id === organizationId);
  if (!organization) return NextResponse.json({ error: "Negocio no encontrado." }, { status: 404 });
  const { status, encryptedAccessToken } = workspace.metaConnection;
  if (status !== "connected" || !encryptedAccessToken) return NextResponse.json({ error: "Conecta Meta para crear formularios." }, { status: 409 });
  const pageId = resolvePageId(workspace, organization.pageId, requestedPageId);
  if (!pageId) return NextResponse.json({ error: "Elige la Página que publicará la campaña." }, { status: 400 });

  try {
    const form = await createLeadForm(encryptedAccessToken, pageId, input);
    await updateWorkspace(session.workspaceId, (current) => ({
      ...current,
      organizations: current.organizations.map((item) => item.id === organizationId ? { ...item, privacyPolicyUrl: input.privacyPolicyUrl } : item),
    }));
    return NextResponse.json({ form });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Meta no pudo crear el formulario." }, { status: 502 });
  }
}
