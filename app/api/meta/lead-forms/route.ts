import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { listLeadForms } from "@/lib/meta";
import { readWorkspace } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  const workspace = await readWorkspace(session.workspaceId);
  const organization = workspace.organizations.find((item) => item.id === organizationId);
  if (!organization) return NextResponse.json({ error: "Negocio no encontrado." }, { status: 404 });
  const { status, encryptedAccessToken } = workspace.metaConnection;
  if (status !== "connected" || !encryptedAccessToken) {
    return NextResponse.json({ forms: [], reason: "Conecta Meta para usar tus formularios instantáneos." });
  }
  if (!organization.pageId) {
    return NextResponse.json({ forms: [], reason: "Este negocio no tiene una Página de Facebook vinculada." });
  }
  try {
    return NextResponse.json({ forms: await listLeadForms(encryptedAccessToken, organization.pageId) });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Meta no devolvió los formularios.";
    return NextResponse.json({ forms: [], reason }, { status: 502 });
  }
}
