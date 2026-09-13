import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth";
import { emailConfigured } from "@/lib/email";
import { reportUrl } from "@/lib/report-delivery";
import { getReportLink, readWorkspace, revokeReportLinks, rotateReportLink } from "@/lib/store";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ organizationId: z.string().min(1) });

async function ownsOrganization(workspaceId: string, organizationId: string): Promise<boolean> {
  const workspace = await readWorkspace(workspaceId);
  return workspace.organizations.some((organization) => organization.id === organizationId);
}

export async function GET(request: Request) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const organizationId = new URL(request.url).searchParams.get("organizationId") ?? "";
  if (!(await ownsOrganization(session.workspaceId, organizationId))) return NextResponse.json({ error: "Negocio no encontrado." }, { status: 404 });
  try {
    const link = await getReportLink(session.workspaceId, organizationId);
    return NextResponse.json({
      link: link && { url: reportUrl(link.token, request), createdAt: link.createdAt },
      emailConfigured: emailConfigured(),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible leer el enlace." }, { status: 500 });
  }
}

/** Creates the share link, or replaces the current one. */
export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  if (!(await ownsOrganization(session.workspaceId, parsed.data.organizationId))) return NextResponse.json({ error: "Negocio no encontrado." }, { status: 404 });
  try {
    const link = await rotateReportLink(session.workspaceId, parsed.data.organizationId);
    return NextResponse.json({ link: { url: reportUrl(link.token, request), createdAt: link.createdAt } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible crear el enlace." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  if (!(await ownsOrganization(session.workspaceId, parsed.data.organizationId))) return NextResponse.json({ error: "Negocio no encontrado." }, { status: 404 });
  await revokeReportLinks(session.workspaceId, parsed.data.organizationId);
  return NextResponse.json({ link: null });
}
