import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth";
import { createVideoUpload, MAX_VIDEO_BYTES, VIDEO_EXTENSIONS } from "@/lib/media-storage";

const schema = z.object({ contentType: z.string().min(1), size: z.number().int().positive() });

/** A signed URL the browser uploads an ad video to; the campaign request only carries its path. */
export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  const { contentType, size } = parsed.data;
  if (!VIDEO_EXTENSIONS[contentType]) return NextResponse.json({ error: "Usa un video MP4 o MOV." }, { status: 400 });
  if (size > MAX_VIDEO_BYTES) return NextResponse.json({ error: "El video debe pesar hasta 50 MB." }, { status: 413 });
  try {
    return NextResponse.json(await createVideoUpload(session.workspaceId, contentType));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo preparar la subida del video." }, { status: 502 });
  }
}
