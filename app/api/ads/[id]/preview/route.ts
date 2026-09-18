import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { isPreviewFormat } from "@/lib/campaign-detail";
import { fetchAdCampaignId, fetchAdPreview } from "@/lib/meta";
import { readWorkspace } from "@/lib/store";

export const dynamic = "force-dynamic";

/** The ad rendered by Meta, as a link the app shows in an iframe. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  const format = new URL(request.url).searchParams.get("format") ?? "MOBILE_FEED_STANDARD";
  if (!isPreviewFormat(format)) return NextResponse.json({ error: "Formato no disponible." }, { status: 400 });
  const workspace = await readWorkspace(session.workspaceId);
  const { status, encryptedAccessToken } = workspace.metaConnection;
  if (status !== "connected" || !encryptedAccessToken) return NextResponse.json({ error: "Conecta Meta para ver el anuncio." }, { status: 409 });
  try {
    // An ad created after the last sync is not stored yet, so Meta says which campaign it belongs to.
    const stored = workspace.ads.some((item) => item.id === id);
    const campaignId = stored ? undefined : await fetchAdCampaignId(encryptedAccessToken, id);
    if (!stored && !workspace.campaigns.some((campaign) => campaign.id === campaignId)) {
      return NextResponse.json({ error: "Anuncio no encontrado." }, { status: 404 });
    }
    const url = await fetchAdPreview(encryptedAccessToken, id, format);
    if (!url) return NextResponse.json({ error: "Meta no tiene vista previa en este formato." }, { status: 404 });
    return NextResponse.json({ url });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Meta no devolvió la vista previa." }, { status: 502 });
  }
}
