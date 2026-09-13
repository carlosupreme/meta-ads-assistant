import crypto from "node:crypto";
import { decryptSecret } from "./crypto";
import type { Ad, AdSetBudget, Campaign, MetricPoint, Organization, WorkspaceData } from "./types";

const version = process.env.META_GRAPH_VERSION || "v26.0";
const graphBase = `https://graph.facebook.com/${version}`;
const MAX_PAGES = 10;

type GraphResponse<T> = { data?: T[]; paging?: { next?: string }; error?: { message: string; code: number } };
type ActionStats = Array<{ action_type: string; value: string }>;

function appSecretProof(token: string): string | undefined {
  return process.env.META_APP_SECRET
    ? crypto.createHmac("sha256", process.env.META_APP_SECRET).update(token).digest("hex")
    : undefined;
}

async function graphFetch<T>(url: URL, token: string): Promise<T> {
  url.searchParams.set("access_token", token);
  const proof = appSecretProof(token);
  if (proof) url.searchParams.set("appsecret_proof", proof);
  const response = await fetch(url, { cache: "no-store" });
  const body = (await response.json()) as T & { error?: { message: string } };
  if (!response.ok || body.error) throw new Error(body.error?.message || "Meta devolvió un error");
  return body;
}

async function graphGet<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${graphBase}/${path.replace(/^\//, "")}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return graphFetch<T>(url, token);
}

/** Follows `paging.next` so accounts with many campaigns or ads are fully imported. */
async function graphGetAll<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T[]> {
  let page = await graphGet<GraphResponse<T>>(path, token, params);
  const items = [...(page.data || [])];
  for (let count = 1; page.paging?.next && count < MAX_PAGES; count += 1) {
    page = await graphFetch<GraphResponse<T>>(new URL(page.paging.next), token);
    items.push(...(page.data || []));
  }
  return items;
}

async function graphPost<T>(path: string, token: string, params: Record<string, string | number>): Promise<T> {
  const body = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => body.set(key, String(value)));
  body.set("access_token", token);
  const proof = appSecretProof(token);
  if (proof) body.set("appsecret_proof", proof);
  const response = await fetch(`${graphBase}/${path.replace(/^\//, "")}`, { method: "POST", body });
  const result = (await response.json()) as T & { error?: { message: string } };
  if (!response.ok || result.error) throw new Error(result.error?.message || "Meta devolvió un error");
  return result;
}

function actionValue(actions: ActionStats | undefined, keys: string[]): number {
  const item = actions?.find((action) => keys.includes(action.action_type));
  return Number(item?.value || 0);
}

function resultCount(actions: ActionStats | undefined): number {
  return actionValue(actions, ["purchase", "omni_purchase"])
    || actionValue(actions, ["lead", "onsite_conversion.lead_grouped"])
    || actionValue(actions, ["onsite_conversion.messaging_conversation_started_7d"]);
}

const purchaseValue = (values: ActionStats | undefined) => actionValue(values, ["purchase", "omni_purchase"]);

interface MetaAdAccount {
  id: string;
  name: string;
  currency?: string;
  account_status?: number;
}

interface MetaPage {
  id: string;
  name: string;
  instagram_business_account?: { id: string; username?: string };
}

interface MetaInsight {
  campaign_id: string;
  campaign_name: string;
  spend?: string;
  actions?: ActionStats;
  action_values?: ActionStats;
}

interface MetaCampaign {
  id: string;
  name: string;
  status: string;
  objective?: string;
  daily_budget?: string;
  updated_time?: string;
}

interface MetaAdSet {
  id: string;
  name: string;
  campaign_id: string;
  status: string;
  daily_budget?: string;
}

interface MetaAd {
  id: string;
  name: string;
  effective_status?: string;
  adset_id: string;
  campaign_id: string;
}

interface MetaAdInsight {
  ad_id: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  ctr?: string;
  frequency?: string;
  actions?: ActionStats;
  action_values?: ActionStats;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<string> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) throw new Error("Faltan META_APP_ID o META_APP_SECRET");
  const url = new URL(`${graphBase}/oauth/access_token`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code", code);
  const response = await fetch(url, { cache: "no-store" });
  const body = (await response.json()) as { access_token?: string; error?: { message: string } };
  if (!response.ok || !body.access_token) throw new Error(body.error?.message || "No fue posible obtener el token");
  const longLivedUrl = new URL(`${graphBase}/oauth/access_token`);
  longLivedUrl.searchParams.set("grant_type", "fb_exchange_token");
  longLivedUrl.searchParams.set("client_id", appId);
  longLivedUrl.searchParams.set("client_secret", appSecret);
  longLivedUrl.searchParams.set("fb_exchange_token", body.access_token);
  const longLivedResponse = await fetch(longLivedUrl, { cache: "no-store" });
  const longLivedBody = (await longLivedResponse.json()) as { access_token?: string };
  return longLivedBody.access_token || body.access_token;
}

export async function fetchMetaIdentity(token: string): Promise<{ id: string; name: string }> {
  return graphGet("me", token, { fields: "id,name" });
}

export async function fetchAdAccounts(token: string): Promise<MetaAdAccount[]> {
  return graphGetAll<MetaAdAccount>("me/adaccounts", token, { fields: "id,name,currency,account_status", limit: "100" });
}

export async function fetchManagedPages(token: string): Promise<MetaPage[]> {
  return graphGetAll<MetaPage>("me/accounts", token, { fields: "id,name,instagram_business_account{id,username}", limit: "100" });
}

async function fetchFirstPixel(accountId: string, token: string): Promise<string | undefined> {
  try {
    const response = await graphGet<GraphResponse<{ id: string; name: string }>>(`${accountId}/adspixels`, token, {
      fields: "id,name",
      limit: "10",
    });
    return response.data?.[0]?.id;
  } catch {
    return undefined;
  }
}

export async function syncMetaWorkspace(workspace: WorkspaceData): Promise<WorkspaceData> {
  const encryptedToken = workspace.metaConnection.encryptedAccessToken;
  if (!encryptedToken) throw new Error("No hay una conexión activa con Meta");
  const token = decryptSecret(encryptedToken);
  const [accounts, pages] = await Promise.all([fetchAdAccounts(token), fetchManagedPages(token)]);
  const actualOrganizations: Organization[] = [];
  const actualCampaigns: Campaign[] = [];
  const actualAds: Ad[] = [];
  const actualMetrics: Record<string, MetricPoint[]> = {};

  for (const [index, account] of accounts.entries()) {
    const organizationId = `meta-${account.id.replace("act_", "")}`;
    const previous = workspace.organizations.find((item) => item.adAccountId === account.id);
    const page = previous?.pageId ? pages.find((item) => item.id === previous.pageId) : pages[index] || pages[0];
    const resultValue = previous?.resultValue || 0;
    const [campaignRows, insightRows, dailyResponse, adSetRows, adRows, adInsightRows, pixelId] = await Promise.all([
      graphGetAll<MetaCampaign>(`${account.id}/campaigns`, token, {
        fields: "id,name,status,objective,daily_budget,updated_time",
        limit: "100",
      }),
      graphGetAll<MetaInsight>(`${account.id}/insights`, token, {
        fields: "campaign_id,campaign_name,spend,actions,action_values",
        level: "campaign",
        date_preset: "this_month",
        limit: "100",
      }),
      graphGet<GraphResponse<{ date_start: string; spend?: string; action_values?: ActionStats }>>(`${account.id}/insights`, token, {
        fields: "spend,action_values",
        date_preset: "last_14d",
        time_increment: "1",
      }),
      graphGetAll<MetaAdSet>(`${account.id}/adsets`, token, {
        fields: "id,name,campaign_id,status,daily_budget",
        limit: "200",
      }),
      graphGetAll<MetaAd>(`${account.id}/ads`, token, {
        fields: "id,name,effective_status,adset_id,campaign_id",
        limit: "200",
      }),
      graphGetAll<MetaAdInsight>(`${account.id}/insights`, token, {
        fields: "ad_id,spend,impressions,clicks,ctr,frequency,actions,action_values",
        level: "ad",
        date_preset: "last_7d",
        limit: "200",
      }),
      fetchFirstPixel(account.id, token),
    ]);

    const insights = new Map(insightRows.map((item) => [item.campaign_id, item]));
    let totalSpend = 0;
    let totalRevenue = 0;
    for (const campaign of campaignRows) {
      const insight = insights.get(campaign.id);
      const spend = Number(insight?.spend || 0);
      const results = resultCount(insight?.actions);
      const revenue = purchaseValue(insight?.action_values) || results * resultValue;
      const adSets: AdSetBudget[] = adSetRows
        .filter((adSet) => adSet.campaign_id === campaign.id)
        .map((adSet) => ({
          id: adSet.id,
          name: adSet.name,
          status: adSet.status === "ACTIVE" ? "ACTIVE" : "PAUSED",
          dailyBudget: Number(adSet.daily_budget || 0) / 100,
        }));
      const campaignBudget = Number(campaign.daily_budget || 0) / 100;
      const adSetBudget = adSets.filter((adSet) => adSet.status === "ACTIVE").reduce((sum, adSet) => sum + adSet.dailyBudget, 0);
      const budgetLevel = campaignBudget > 0 ? "campaign" : adSetBudget > 0 ? "adset" : "none";
      totalSpend += spend;
      totalRevenue += revenue;
      actualCampaigns.push({
        id: campaign.id,
        organizationId,
        name: campaign.name,
        status: campaign.status === "ACTIVE" ? "ACTIVE" : "PAUSED",
        objective: (campaign.objective || "Resultados").replaceAll("_", " "),
        channel: "Facebook + Instagram",
        spend,
        results,
        costPerResult: results ? spend / results : 0,
        revenue,
        roas: spend ? revenue / spend : 0,
        trend: 0,
        dailyBudget: budgetLevel === "campaign" ? campaignBudget : adSetBudget,
        budgetLevel,
        adSets,
        updatedAt: campaign.updated_time ? new Date(campaign.updated_time).toLocaleDateString("es-MX") : "Ahora",
      });
    }

    const adInsights = new Map(adInsightRows.map((item) => [item.ad_id, item]));
    for (const ad of adRows) {
      const insight = adInsights.get(ad.id);
      const results = resultCount(insight?.actions);
      actualAds.push({
        id: ad.id,
        organizationId,
        campaignId: ad.campaign_id,
        adSetId: ad.adset_id,
        name: ad.name,
        status: ad.effective_status === "ACTIVE" ? "ACTIVE" : "PAUSED",
        spend: Number(insight?.spend || 0),
        impressions: Number(insight?.impressions || 0),
        clicks: Number(insight?.clicks || 0),
        ctr: Number(insight?.ctr || 0),
        frequency: Number(insight?.frequency || 0),
        results,
        revenue: purchaseValue(insight?.action_values) || results * resultValue,
      });
    }

    actualOrganizations.push({
      id: organizationId,
      name: account.name,
      initials: account.name.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase(),
      color: ["#7c5cff", "#f97349", "#13b981", "#2786ff"][index % 4],
      pageName: page?.name || previous?.pageName || "Página por vincular",
      pageId: page?.id || previous?.pageId,
      instagramHandle: page?.instagram_business_account?.username ? `@${page.instagram_business_account.username}` : previous?.instagramHandle || "Instagram por vincular",
      instagramAccountId: page?.instagram_business_account?.id || previous?.instagramAccountId,
      pixelId: pixelId || previous?.pixelId,
      adAccountId: account.id,
      currency: "MXN",
      objective: previous?.objective || "Ventas",
      mode: previous?.mode || "copilot",
      monthlyLimit: previous?.monthlyLimit || 50000,
      targetRoas: previous?.targetRoas,
      spentThisMonth: totalSpend,
      revenueThisMonth: totalRevenue,
      resultValue,
      connected: account.account_status === 1,
    });

    actualMetrics[organizationId] = (dailyResponse.data || []).map((point) => {
      const spend = Number(point.spend || 0);
      const revenue = purchaseValue(point.action_values);
      return {
        date: new Date(`${point.date_start}T12:00:00`).toLocaleDateString("es-MX", { day: "2-digit", month: "short" }),
        spend,
        revenue,
        roas: spend ? revenue / spend : 0,
      };
    });
  }

  return {
    ...workspace,
    metaConnection: { ...workspace.metaConnection, status: "connected", lastSyncAt: new Date().toISOString() },
    organizations: actualOrganizations.length ? actualOrganizations : workspace.organizations,
    campaigns: actualCampaigns,
    ads: actualAds,
    metrics: actualMetrics,
  };
}

/**
 * Applies synced Meta data on top of the latest stored workspace. Settings a person may have changed
 * during the sync (mode, limits, targets) and the agents' history always come from `current`.
 */
export function mergeSyncedWorkspace(current: WorkspaceData, synced: WorkspaceData): WorkspaceData {
  if (current.metaConnection.status !== "connected") return current;
  return {
    ...current,
    metaConnection: { ...current.metaConnection, lastSyncAt: synced.metaConnection.lastSyncAt },
    organizations: synced.organizations.map((organization) => {
      const local = current.organizations.find((item) => item.id === organization.id);
      return local
        ? { ...organization, mode: local.mode, monthlyLimit: local.monthlyLimit, targetRoas: local.targetRoas, resultValue: local.resultValue, objective: local.objective }
        : organization;
    }),
    campaigns: synced.campaigns,
    ads: synced.ads,
    metrics: synced.metrics,
  };
}

export interface MetaCampaignInput {
  offer: string;
  destination: string;
  dailyBudget: number;
  publish: boolean;
}

export async function createMetaSalesCampaign(
  encryptedToken: string,
  organization: Organization,
  input: MetaCampaignInput,
): Promise<{ campaignId: string; status: "ACTIVE" | "PAUSED" }> {
  if (!organization.pageId) throw new Error("Selecciona una Página de Facebook antes de publicar");
  if (!organization.pixelId) throw new Error("Selecciona un Pixel/dataset con el evento Purchase antes de publicar");
  let destination: URL;
  try {
    destination = new URL(input.destination);
  } catch {
    throw new Error("Para campañas de ventas, el destino debe ser una URL válida");
  }
  const token = decryptSecret(encryptedToken);
  const campaign = await graphPost<{ id: string }>(`${organization.adAccountId}/campaigns`, token, {
    name: `Pulso · Ventas · ${input.offer}`,
    objective: "OUTCOME_SALES",
    buying_type: "AUCTION",
    special_ad_categories: "[]",
    status: "PAUSED",
  });
  const adSet = await graphPost<{ id: string }>(`${organization.adAccountId}/adsets`, token, {
    name: "Pulso · México · Audiencia Advantage+",
    campaign_id: campaign.id,
    daily_budget: Math.round(input.dailyBudget * 100),
    billing_event: "IMPRESSIONS",
    optimization_goal: "OFFSITE_CONVERSIONS",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    destination_type: "WEBSITE",
    promoted_object: JSON.stringify({ pixel_id: organization.pixelId, custom_event_type: "PURCHASE" }),
    targeting: JSON.stringify({ geo_locations: { countries: ["MX"] }, age_min: 18, age_max: 65 }),
    status: "PAUSED",
  });
  const creative = await graphPost<{ id: string }>(`${organization.adAccountId}/adcreatives`, token, {
    name: `Pulso · Creative · ${input.offer}`,
    ...(organization.instagramAccountId ? { instagram_user_id: organization.instagramAccountId } : {}),
    object_story_spec: JSON.stringify({
      page_id: organization.pageId,
      link_data: {
        link: destination.toString(),
        message: `Descubre ${input.offer}. Conoce todos los detalles y compra hoy.`,
        name: input.offer,
        call_to_action: { type: "SHOP_NOW", value: { link: destination.toString() } },
      },
    }),
  });
  const ad = await graphPost<{ id: string }>(`${organization.adAccountId}/ads`, token, {
    name: `Pulso · ${input.offer} · Variante 1`,
    adset_id: adSet.id,
    creative: JSON.stringify({ creative_id: creative.id }),
    status: "PAUSED",
  });
  if (input.publish) {
    await graphPost(campaign.id, token, { status: "ACTIVE" });
    await graphPost(adSet.id, token, { status: "ACTIVE" });
    await graphPost(ad.id, token, { status: "ACTIVE" });
  }
  return { campaignId: campaign.id, status: input.publish ? "ACTIVE" : "PAUSED" };
}

/** Updates status or daily budget (in account currency) of a campaign, ad set or ad. */
export async function updateMetaObject(
  encryptedToken: string,
  objectId: string,
  changes: { status?: "ACTIVE" | "PAUSED"; daily_budget?: number },
): Promise<void> {
  const token = decryptSecret(encryptedToken);
  const params: Record<string, string | number> = {};
  if (changes.status) params.status = changes.status;
  if (changes.daily_budget !== undefined) params.daily_budget = Math.round(changes.daily_budget * 100);
  await graphPost(objectId, token, params);
}
