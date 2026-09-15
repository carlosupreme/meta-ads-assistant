import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth";
import { searchTargeting } from "@/lib/meta";
import { readWorkspace } from "@/lib/store";

export const dynamic = "force-dynamic";

const schema = z.object({ kind: z.enum(["location", "interest"]), q: z.string().trim().min(2).max(60) });

/** Places and interests Meta can target, for the campaign creator's pickers. */
export async function GET(request: Request) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const parsed = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ options: [] });
  const { status, encryptedAccessToken } = (await readWorkspace(session.workspaceId)).metaConnection;
  if (status !== "connected" || !encryptedAccessToken) {
    return NextResponse.json({ options: [], reason: "Conecta Meta para buscar ubicaciones e intereses." });
  }
  try {
    return NextResponse.json({ options: await searchTargeting(encryptedAccessToken, parsed.data.kind, parsed.data.q) });
  } catch (error) {
    return NextResponse.json({ options: [], reason: error instanceof Error ? error.message : "Meta no respondió la búsqueda." }, { status: 502 });
  }
}
