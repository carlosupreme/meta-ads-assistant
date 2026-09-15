import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { listLeadForms } from "@/lib/meta";
import { readWorkspace } from "@/lib/store";

export const dynamic = "force-dynamic";

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
  // The creator may publish with any Page the profile manages; unknown ids fall back to the business default.
  const requested = params.get("pageId");
  const pageId = requested && workspace.pages?.some((page) => page.id === requested) ? requested : organization.pageId;
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
