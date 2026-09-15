import { NextResponse } from "next/server";
import { z } from "zod";
import { aiStatus, planCampaign } from "@/lib/ai/openai";
import { requireApiSession } from "@/lib/auth";
import { searchTargeting, type TargetingOption } from "@/lib/meta";
import { readWorkspace } from "@/lib/store";
import { DEFAULT_AUDIENCE, normalizeAudience } from "@/lib/targeting";
import type { AudienceSpec, TargetInterest, TargetLocation } from "@/lib/types";

export const maxDuration = 60;

const schema = z.object({
  organizationId: z.string().min(1),
  pageId: z.string().max(40).optional(),
  offer: z.string().trim().min(3).max(120),
  customer: z.string().trim().max(300).default(""),
  area: z.string().trim().max(120).default(""),
  details: z.string().trim().max(600).default(""),
  website: z.string().trim().max(500).default(""),
});

const isLocation = (option: TargetingOption): option is TargetLocation => option.type !== "interest";

/**
 * AI recommendation for a new campaign: objective, audience, budget and tips. Places and interests the model
 * names are looked up in Meta, so the creator only ever holds targeting Meta accepts.
 */
export async function POST(request: Request) {
  const session = await requireApiSession();
  if (session instanceof NextResponse) return session;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Describe al menos qué quieres promocionar." }, { status: 400 });
  const input = parsed.data;
  const workspace = await readWorkspace(session.workspaceId);
  const organization = workspace.organizations.find((item) => item.id === input.organizationId);
  if (!organization) return NextResponse.json({ error: "Negocio no encontrado." }, { status: 404 });
  const ai = aiStatus(workspace.aiModel);
  if (!ai.configured || !ai.model) return NextResponse.json({ error: ai.reason ?? "OpenAI no está configurado." }, { status: 503 });

  try {
    const page = workspace.pages?.find((item) => item.id === input.pageId);
    const plan = await planCampaign(ai.model, {
      business: organization.name,
      pageName: page?.name ?? organization.pageName,
      offer: input.offer,
      customer: input.customer,
      area: input.area,
      details: input.details,
      website: input.website,
      hasPixel: Boolean(organization.pixelId),
      monthlyLimit: organization.monthlyLimit,
    });

    // Sales campaigns cannot be created without a website and a Pixel; recommend what can actually launch.
    const salesBlocked = plan.objective === "Ventas" && (!organization.pixelId || !input.website);
    const objective = salesBlocked ? "Mensajes" : plan.objective;
    const objectiveReason = salesBlocked
      ? `${plan.objectiveReason} Como tu cuenta aún no tiene ${organization.pixelId ? "sitio web" : "Pixel"} para medir ventas, Pulso sugiere empezar con Mensajes.`
      : plan.objectiveReason;
    const maxDaily = Math.max(100, Math.floor(organization.monthlyLimit / 30));

    const { status, encryptedAccessToken } = workspace.metaConnection;
    const token = status === "connected" ? encryptedAccessToken : undefined;
    const locationTerms = plan.audience.locations.slice(0, 5);
    const interestTerms = plan.audience.interests.slice(0, 6);
    const lookup = <T>(term: string, kind: "location" | "interest", pick: (options: TargetingOption[]) => T | undefined) =>
      token ? searchTargeting(token, kind, term).then(pick).catch(() => undefined) : Promise.resolve(undefined);
    const [locations, interests] = await Promise.all([
      Promise.all(locationTerms.map((term) => lookup(term, "location", (options) => options.find(isLocation)))),
      Promise.all(interestTerms.map((term) => lookup(term, "interest", (options): TargetInterest | undefined => {
        const match = options.find((option) => option.type === "interest");
        return match && match.type === "interest" ? { id: match.id, name: match.name, detail: match.detail } : undefined;
      }))),
    ]);

    const audience: AudienceSpec = normalizeAudience({
      advantage: plan.audience.advantage,
      ageMin: plan.audience.ageMin,
      ageMax: plan.audience.ageMax,
      genders: plan.audience.genders,
      locations: locations.filter((item): item is TargetLocation => Boolean(item)),
      interests: interests.filter((item): item is TargetInterest => Boolean(item)),
    });
    const unresolved = [
      ...locationTerms.filter((_, index) => !locations[index]),
      ...interestTerms.filter((_, index) => !interests[index]),
    ];

    return NextResponse.json({
      plan: {
        objective,
        objectiveReason,
        messagingApp: objective === "Mensajes" ? plan.messagingApp ?? "MESSENGER" : null,
        customerProfile: plan.customerProfile,
        audienceReason: plan.audience.reason,
        dailyBudget: Math.min(maxDaily, Math.max(100, Math.round(plan.dailyBudget / 10) * 10)),
        budgetReason: plan.budgetReason,
        tips: plan.tips,
      },
      audience: audience.locations.length ? audience : { ...audience, locations: DEFAULT_AUDIENCE.locations },
      unresolved,
    });
  } catch (error) {
    console.error("Campaign plan failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "La IA no pudo preparar la recomendación." }, { status: 502 });
  }
}
