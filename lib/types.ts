export type AutomationMode = "observer" | "copilot" | "autonomous" | "yolo";

export type NavView =
  | "dashboard"
  | "campaigns"
  | "agents"
  | "creatives"
  | "alerts"
  | "reports"
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
  report?: ReportSettings;
  funding?: AccountFunding;
}

/** A Facebook Page the connected profile can advertise with. */
export interface ManagedPage {
  id: string;
  name: string;
  instagramAccountId?: string;
  instagramHandle?: string;
  /** Where Meta listed it: the profile's own page roles or a business portfolio. */
  source: "profile" | "business";
}

/** Funds and payment setup of the ad account, as Meta reports them on the last sync. */
export interface AccountFunding {
  prepaid: boolean;
  /** Meta's own description of the payment method, e.g. "Available Balance ($0.00 MXN)". */
  paymentMethod?: string;
  /** Remaining prepaid funds, when Meta's description includes the amount. */
  availableBalance?: number;
  amountSpent: number;
  /** 0 means the account has no spending limit. */
  spendCap: number;
  syncedAt: string;
}

/** Client reporting preferences for one business. */
export interface ReportSettings {
  clientEmails: string[];
  weeklyEmail: boolean;
  lastSentAt?: string;
}

/** Agency identity shown on client reports and emails. */
export interface Branding {
  agencyName: string;
  accentColor: string;
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
  /** Pages its ads publish for; one ad account can run campaigns for several Pages. */
  pageIds?: string[];
  updatedAt: string;
}

export interface TargetLocation {
  /** Meta's key: a country code, or the numeric key of a region or city. */
  key: string;
  name: string;
  type: "country" | "region" | "city";
  detail?: string;
}

export interface TargetInterest {
  id: string;
  name: string;
  detail?: string;
}

/** Who a new campaign reaches. With Advantage+ audience, age range and interests are suggestions Meta may widen. */
export interface AudienceSpec {
  advantage: boolean;
  ageMin: number;
  ageMax: number;
  genders: "all" | "male" | "female";
  locations: TargetLocation[];
  interests: TargetInterest[];
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
  creative?: AdCreative;
  /** Page the ad publishes for. */
  pageId?: string;
}

/** Copy and story spec of an ad, kept so new variants can reuse its image and destination. */
export interface AdCreative {
  id: string;
  headline?: string;
  primaryText?: string;
  /** True for image link ads with page, link and image: the formats a variant can clone. */
  reusable: boolean;
  /** JSON of Meta's object_story_spec. */
  spec?: string;
}

/** A new ad cloned from an existing one in the same ad set, with new copy and optionally a new image. */
export interface AdVariant {
  adSetId: string;
  sourceAdId: string;
  headline: string;
  primaryText: string;
  imageHash?: string;
}

export type AgentName = "Supervisor" | "Presupuesto" | "Audiencias" | "Creativos" | "Analista" | "Estratega";

export type AgentActionType =
  | "increase_budget"
  | "decrease_budget"
  | "pause_campaign"
  | "resume_campaign"
  | "pause_ad"
  | "resume_ad"
  | "create_ad";

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
  variant?: AdVariant;
  /** Meta id of the ad a create_ad action produced. */
  createdAdId?: string;
  fromBudget?: number;
  toBudget?: number;
  reason: string;
  impact: string;
  /** "user" marks changes a person made through Pulso; agents never undo those. */
  source: "rules" | "ai" | "user";
  /** Why a status change happened; decides whether Pulso may undo it later. */
  trigger?: "limit" | "fatigue" | "no_results" | "ai" | "manual";
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
  /** A user change resets the baseline the agents' 20% cap is measured from. */
  source?: "agent" | "user";
}

/** Daily roll-up of what the agents checked for one business, including runs where nothing needed changing. */
export interface MonitoringDay {
  /** UTC date, YYYY-MM-DD. */
  date: string;
  runs: number;
  /** Most active campaigns seen in a single run that day. */
  campaignsChecked: number;
  /** Most active ads seen in a single run that day. */
  adsChecked: number;
  /** New risk signals found: fatigue, spend without results, low return or overspending pace. */
  anomalies: number;
  blocked: number;
  executed: number;
  lastRunAt: string;
}

export type CampaignVerdict = "attention" | "watch" | "learning" | "no_data" | "good" | "excellent" | "paused" | "draft";

/** One message per campaign after an analysis, so every campaign gets a verdict even when nothing changes. */
export interface CampaignReview {
  campaignId: string;
  campaignName: string;
  pageIds?: string[];
  verdict: CampaignVerdict;
  title: string;
  detail: string;
  spend: number;
  results: number;
  roas: number;
  costPerResult: number;
  dailyBudget: number;
  /** Action taken or proposed for this campaign by the latest analysis. */
  actionId?: string;
  /** "ai" once the campaign was analyzed on its own by the model; otherwise the rules wrote the message. */
  source?: "rules" | "ai";
}

export interface MetricPoint {
  /** ISO day (YYYY-MM-DD), used to add series from several campaigns in order. */
  day?: string;
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
  /** Every Page the connected Meta profile can publish with, shared by all its ad accounts. */
  pages?: ManagedPage[];
  metrics: Record<string, MetricPoint[]>;
  activities: AgentActivity[];
  alerts: AlertItem[];
  creatives: Creative[];
  actions: AgentAction[];
  budgetChanges: BudgetChange[];
  /** Per business id, the last weeks of monitoring activity. */
  monitoring?: Record<string, MonitoringDay[]>;
  /** Daily spend and revenue per campaign id, so a Page's series can be added from its campaigns. */
  campaignMetrics?: Record<string, MetricPoint[]>;
  /** Per business id, the per-campaign review of the latest analysis. */
  campaignReviews?: Record<string, { at: string; items: CampaignReview[] }>;
  /** OpenAI model chosen by the workspace owner; generative AI stays off until one is picked. */
  aiModel?: string;
  branding?: Branding;
  /** Prevents the cron and a manual run from optimizing the same account at once. */
  agentLock?: { token: string; expiresAt: string };
}

export const MODE_LABELS: Record<AutomationMode, string> = {
  observer: "Observador",
  copilot: "Copiloto",
  autonomous: "Autónomo",
  yolo: "YOLO",
};
