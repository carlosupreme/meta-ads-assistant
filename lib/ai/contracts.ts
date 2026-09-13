import type { Ad, AgentAction, AgentActionType, AgentName, Campaign, Organization } from "@/lib/types";

export type AiProviderId = "local" | "openai" | "openai-compatible" | "gemini" | "custom";

export interface AiProviderStatus {
  id: AiProviderId;
  label: string;
  model: string | null;
  configured: boolean;
  reason?: string;
}

export interface AiCampaignContext {
  organization: Pick<Organization, "id" | "name" | "objective" | "monthlyLimit" | "targetRoas" | "spentThisMonth" | "revenueThisMonth" | "resultValue" | "mode">;
  campaigns: Array<Pick<Campaign, "id" | "name" | "status" | "objective" | "spend" | "results" | "costPerResult" | "revenue" | "roas" | "trend" | "dailyBudget" | "budgetLevel">>;
  ads: Array<Pick<Ad, "id" | "campaignId" | "name" | "status" | "spend" | "impressions" | "ctr" | "frequency" | "results">>;
  /** Changes the rules engine already proposed this cycle, so the model does not repeat them. */
  plannedActions: Array<Pick<AgentAction, "type" | "campaignId" | "adId" | "fromBudget" | "toBudget">>;
}

export interface AiRecommendation {
  agent: AgentName;
  title: string;
  detail: string;
  impact: string;
  urgency: "info" | "warning" | "action";
}

/** A concrete change suggested by the model. It is never executed without passing the guardrails. */
export interface AiActionProposal {
  type: AgentActionType;
  campaignId: string;
  adId?: string;
  /** Percent change for budget actions, between -20 and 20. */
  changePct?: number;
  reason: string;
  impact: string;
}

export interface AiAnalysis {
  headline: string;
  summary: string;
  recommendations: AiRecommendation[];
  actions: AiActionProposal[];
}

export interface AiProvider {
  status(): AiProviderStatus;
  analyze(context: AiCampaignContext): Promise<AiAnalysis>;
  ask(context: AiCampaignContext, question: string): Promise<string>;
}
