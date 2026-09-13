import type { Ad, AgentAction, AgentActionType, AgentName, Campaign, Organization } from "@/lib/types";

/** Whether OpenAI can be used for this workspace, and why not. */
export interface AiStatus {
  configured: boolean;
  model: string | null;
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
