import { NextResponse } from "next/server";
import { getAiProvider } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getAiProvider().status());
}
