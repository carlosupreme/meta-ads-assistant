import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth";
import { emailConfigured } from "@/lib/email";
import { deliverReport } from "@/lib/report-delivery";

const schema = z.object({ organizationId: z.string().min(1) });

export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  if (!emailConfigured()) return NextResponse.json({ error: "Configura RESEND_API_KEY y REPORTS_FROM_EMAIL en el servidor." }, { status: 503 });
  try {
    const { sentTo } = await deliverReport(session.workspaceId, parsed.data.organizationId, { request, manual: true });
    return NextResponse.json({ message: `Resumen enviado a ${sentTo} ${sentTo === 1 ? "persona" : "personas"}.` });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible enviar el resumen." }, { status: 502 });
  }
}
