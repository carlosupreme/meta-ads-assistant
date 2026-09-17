import { NextResponse } from "next/server";
import { loadCall } from "@/lib/data";

export const dynamic = "force-dynamic";

/** One call as a JSON download, entry included. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await loadCall(id);
  if (!found) return NextResponse.json({ error: "Llamada no encontrada" }, { status: 404 });
  return new NextResponse(JSON.stringify({ ...found.call, entry: found.entry }, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="pulso-ia-${id}.json"`,
    },
  });
}
