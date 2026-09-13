import { NextResponse } from "next/server";
import { getAiProvider } from "@/lib/ai/provider";
import { requireApiSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  return NextResponse.json(getAiProvider().status());
}
