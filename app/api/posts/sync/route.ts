import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth";
import { fetchPagePosts } from "@/lib/meta";
import { toSafeWorkspace } from "@/lib/safe-workspace";
import { readWorkspace, updateWorkspace } from "@/lib/store";
import type { PagePost } from "@/lib/types";

// One Graph call per Page plus a few for insights; Pages with many posts take a while.
export const maxDuration = 300;

const MAX_PAGES_PER_SYNC = 5;
const POSTS_PER_PAGE = 50;
const DAYS = 90;

const schema = z.object({ pageId: z.string().max(40).optional() });

/** Brings the organic posts of one Page (or every connected Page) into the workspace. */
export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });

  const workspace = await readWorkspace(session.workspaceId);
  const { status, encryptedAccessToken } = workspace.metaConnection;
  if (status !== "connected" || !encryptedAccessToken) {
    return NextResponse.json({ error: "Conecta Meta para analizar tus publicaciones." }, { status: 409 });
  }
  const pages = (parsed.data.pageId
    ? (workspace.pages ?? []).filter((page) => page.id === parsed.data.pageId)
    : (workspace.pages ?? [])
  ).slice(0, MAX_PAGES_PER_SYNC);
  if (!pages.length) return NextResponse.json({ error: "No encontramos páginas en tu perfil de Meta. Sincroniza en Conexiones." }, { status: 404 });

  const fetched: PagePost[] = [];
  const failures: string[] = [];
  // One Page failing (no insights permission, no access) must not lose the others.
  for (const page of pages) {
    try {
      fetched.push(...await fetchPagePosts(encryptedAccessToken, page.id, { limit: POSTS_PER_PAGE, sinceDays: DAYS }));
    } catch (error) {
      failures.push(`${page.name}: ${error instanceof Error ? error.message : "Meta no devolvió las publicaciones"}`);
    }
  }
  if (!fetched.length && failures.length) return NextResponse.json({ error: failures.join(" · ") }, { status: 502 });

  const syncedPageIds = new Set(pages.map((page) => page.id));
  const updated = await updateWorkspace(session.workspaceId, (current) => ({
    ...current,
    posts: [...fetched, ...(current.posts ?? []).filter((post) => !syncedPageIds.has(post.pageId))]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    postsSyncedAt: new Date().toISOString(),
  }));

  const message = `${fetched.length} ${fetched.length === 1 ? "publicación traída" : "publicaciones traídas"} de ${pages.length === 1 ? pages[0].name : `${pages.length} páginas`}.`;
  return NextResponse.json({ workspace: toSafeWorkspace(updated), message: failures.length ? `${message} Sin acceso a: ${failures.join(" · ")}` : message });
}
