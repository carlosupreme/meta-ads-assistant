import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/auth";
import { fetchCampaignDetail } from "@/lib/meta";
import { readWorkspace } from "@/lib/store";

export const dynamic = "force-dynamic";

/** The campaign as Meta has it right now: setup, ad sets with their audience, ads and results. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const { id } = await params;
  const workspace = await readWorkspace(session.workspaceId);
  const campaign = workspace.campaigns.find((item) => item.id === id);
  if (!campaign) return NextResponse.json({ error: "Campaña no encontrada." }, { status: 404 });
  const organization = workspace.organizations.find((item) => item.id === campaign.organizationId);
  const { status, encryptedAccessToken } = workspace.metaConnection;
  if (status !== "connected" || !encryptedAccessToken) {
    return NextResponse.json({ error: "Conecta Meta para ver la campaña tal como está publicada." }, { status: 409 });
  }
  try {
    const detail = await fetchCampaignDetail(encryptedAccessToken, id);
    const pages = Object.fromEntries((campaign.pageIds ?? []).map((pageId) => [pageId, workspace.pages?.find((page) => page.id === pageId)?.name ?? "Página sin acceso"]));
    return NextResponse.json({ detail: { ...detail, adAccountId: detail.adAccountId || organization?.adAccountId || "" }, pages });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Meta no devolvió la campaña." }, { status: 502 });
  }
}
