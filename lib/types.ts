export type AutomationMode = "observer" | "copilot" | "autonomous" | "yolo";

export type NavView =
  | "dashboard"
  | "campaigns"
  | "agents"
  | "creatives"
  | "alerts"
  | "connections"
  | "settings";

export interface Organization {
  id: string;
  name: string;
  initials: string;
  color: string;
  pageName: string;
  pageId?: string;
  instagramHandle: string;
  instagramAccountId?: string;
  pixelId?: string;
  adAccountId: string;
  currency: "MXN";
  objective: "Ventas" | "Prospectos" | "Mensajes";
  mode: AutomationMode;
  monthlyLimit: number;
  /** ROAS the agents optimize toward. Defaults to 3 when missing. */
  targetRoas?: number;
  spentThisMonth: number;
  revenueThisMonth: number;
  resultValue: number;
  connected: boolean;
}

export interface Campaign {
  id: string;
  organizationId: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "DRAFT";
  objective: string;
  channel: "Facebook + Instagram" | "Instagram" | "Facebook";
  spend: number;
  results: number;
  costPerResult: number;
  revenue: number;
  roas: number;
  trend: number;
  dailyBudget: number;
  /** Where Meta holds the daily budget. "none" means lifetime budget: agents do not touch it. */
  budgetLevel?: "campaign" | "adset" | "none";
  adSets?: AdSetBudget[];
  updatedAt: string;
}

export interface AdSetBudget {
  id: string;
  name: string;
  status: "ACTIVE" | "PAUSED";
  dailyBudget: number;
}

export interface Ad {
  id: string;
  organizationId: string;
  campaignId: string;
  adSetId: string;
  name: string;
  status: "ACTIVE" | "PAUSED";
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  frequency: number;
  results: number;
  revenue: number;
}

export type AgentName = "Supervisor" | "Presupuesto" | "Audiencias" | "Creativos" | "Analista" | "Estratega";

export type AgentActionType = "increase_budget" | "decrease_budget" | "pause_campaign" | "pause_ad";

export type AgentActionStatus =
  | "recommended"
  | "pending"
  | "executing"
  | "executed"
  | "rejected"
  | "failed"
  | "blocked"
  | "expired";

export interface AgentAction {
  id: string;
  organizationId: string;
  agent: AgentName;
  type: AgentActionType;
  campaignId: string;
  campaignName: string;
  adId?: string;
  adName?: string;
  fromBudget?: number;
  toBudget?: number;
  reason: string;
  impact: string;
  source: "rules" | "ai";
  status: AgentActionStatus;
  /** Why a guardrail stopped the action. */
  guardrail?: string;
  error?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface BudgetChange {
  campaignId: string;
  organizationId: string;
  from: number;
  to: number;
  at: string;
}

export interface MetricPoint {
  date: string;
  spend: number;
  revenue: number;
  roas: number;
}

export interface AgentActivity {
  id: string;
  organizationId: string;
  agent: AgentName;
  title: string;
  detail: string;
  impact: string;
  kind: "action" | "insight" | "warning";
  createdAt: string;
}

export interface AlertItem {
  id: string;
  organizationId: string;
  severity: "critical" | "warning" | "info" | "success";
  title: string;
  detail: string;
  createdAt: string;
  read: boolean;
}

export interface Creative {
  id: string;
  organizationId: string;
  title: string;
  headline: string;
  primaryText: string;
  status: "Ganador" | "Probando" | "Borrador";
  format: "Imagen" | "Video" | "Carrusel";
  score: number;
  palette: string[];
}

export interface WorkspaceData {
  user: { name: string; email: string };
  metaConnection: {
    status: "demo" | "connected" | "disconnected";
    userName?: string;
    connectedAt?: string;
    lastSyncAt?: string;
    encryptedAccessToken?: string;
  };
  organizations: Organization[];
  campaigns: Campaign[];
  ads: Ad[];
  metrics: Record<string, MetricPoint[]>;
  activities: AgentActivity[];
  alerts: AlertItem[];
  creatives: Creative[];
  actions: AgentAction[];
  budgetChanges: BudgetChange[];
  /** OpenAI model chosen by the workspace owner; generative AI stays off until one is picked. */
  aiModel?: string;
  /** Prevents the cron and a manual run from optimizing the same account at once. */
  agentLock?: { token: string; expiresAt: string };
}

export const MODE_LABELS: Record<AutomationMode, string> = {
  observer: "Observador",
  copilot: "Copiloto",
  autonomous: "Autónomo",
  yolo: "YOLO",
};
