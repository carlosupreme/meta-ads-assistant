import { NextResponse } from "next/server";
import { aiStatus, listChatModels } from "@/lib/ai/openai";
import { requireApiSession } from "@/lib/auth";
import { readWorkspace } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const { aiModel } = await readWorkspace(session.workspaceId);
  const status = aiStatus(aiModel);
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ status, models: [] });
  try {
    return NextResponse.json({ status, models: await listChatModels() });
  } catch (error) {
    const reason = `OpenAI: ${error instanceof Error ? error.message : "no respondió"}`;
    return NextResponse.json({ status: { ...status, configured: false, reason }, models: [] });
  }
}
