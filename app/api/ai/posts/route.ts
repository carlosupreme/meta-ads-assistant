import { NextResponse } from "next/server";
import { z } from "zod";
import { aiStatus, analyzePosts } from "@/lib/ai/openai";
import { requestTrace } from "@/lib/ai/trace";
import { requireApiSession } from "@/lib/auth";
import { byFormat, byTimeBlock, byWeekday, FORMAT_LABELS, summarizePosts, topPosts } from "@/lib/posts";
import { toSafeWorkspace } from "@/lib/safe-workspace";
import { readWorkspace, updateWorkspace } from "@/lib/store";

export const maxDuration = 60;

const TOP_POSTS = 5;
const MESSAGE_LIMIT = 300;

const schema = z.object({ pageId: z.string().min(1).max(40) });

/** Reads a Page's organic posts with AI: what is working, what to change and what to publish next. */
export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Elige una página." }, { status: 400 });
  const { pageId } = parsed.data;

  const workspace = await readWorkspace(session.workspaceId);
  const ai = aiStatus(workspace.aiModel);
  if (!ai.configured || !ai.model) return NextResponse.json({ error: ai.reason ?? "OpenAI no está configurado." }, { status: 503 });
  const posts = (workspace.posts ?? []).filter((post) => post.pageId === pageId);
  if (posts.length < 3) return NextResponse.json({ error: "Necesitamos al menos tres publicaciones. Actualiza tus publicaciones primero." }, { status: 409 });
  const page = workspace.pages?.find((item) => item.id === pageId);
  const organization = workspace.organizations.find((item) => item.pageId === pageId) ?? workspace.organizations[0];

  try {
    const stats = summarizePosts(posts);
    const analysis = await analyzePosts(ai.model, {
      page: page?.name ?? "Página",
      business: organization?.name ?? page?.name ?? "Negocio",
      days: 90,
      stats: {
        posts: stats.posts,
        reactions: stats.reactions,
        comments: stats.comments,
        shares: stats.shares,
        averageEngagement: stats.averageEngagement,
        reach: stats.reach,
        engagementRate: stats.engagementRate,
      },
      weekdays: byWeekday(posts).map(({ label, posts: count, average }) => ({ label, posts: count, average: Math.round(average) })),
      blocks: byTimeBlock(posts).map(({ label, posts: count, average }) => ({ label, posts: count, average: Math.round(average) })),
      formats: byFormat(posts).map(({ label, posts: count, average }) => ({ label, posts: count, average: Math.round(average) })),
      top: topPosts(posts, TOP_POSTS).map((post) => ({
        text: (post.message ?? "Sin texto").slice(0, MESSAGE_LIMIT),
        format: FORMAT_LABELS[post.format],
        publishedAt: post.createdAt,
        reactions: post.reactions,
        comments: post.comments,
        shares: post.shares,
        reach: post.reach,
      })),
    }, requestTrace(request, session, organization));

    const updated = await updateWorkspace(session.workspaceId, (current) => ({
      ...current,
      postsAnalysis: {
        ...current.postsAnalysis,
        [pageId]: {
          at: new Date().toISOString(),
          headline: analysis.headline,
          summary: analysis.summary,
          bestTime: analysis.bestTime ?? undefined,
          recommendations: analysis.recommendations,
          ideas: analysis.ideas,
        },
      },
    }));
    return NextResponse.json({ workspace: toSafeWorkspace(updated) });
  } catch (error) {
    console.error("Posts analysis failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "La IA no pudo analizar tus publicaciones." }, { status: 502 });
  }
}
