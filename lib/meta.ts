import crypto from "node:crypto";
import { decryptSecret } from "./crypto";
import type { AccountFunding, Ad, AdSetBudget, Campaign, ManagedPage, MetricPoint, Organization, WorkspaceData } from "./types";
import { campaignPageIds, defaultPageFor, mergePages, pageIdFromCreative, parseAvailableBalance } from "./workspace";

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

interface GraphError {
  message?: string;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
}

// Meta errors worth explaining in Spanish, by error_subcode.
const GRAPH_ERROR_MESSAGES: Record<number, string> = {
  2446886: "Tu Página no tiene una cuenta de WhatsApp Business vinculada. Vincúlala en Meta Business Suite (Configuración → WhatsApp) o elige Messenger.",
};

/** "Invalid parameter" alone does not say what to fix; prefer Meta's user-facing explanation. */
function graphErrorMessage(error: GraphError | undefined): string {
  if (error?.error_subcode && GRAPH_ERROR_MESSAGES[error.error_subcode]) return GRAPH_ERROR_MESSAGES[error.error_subcode];
  if (error?.error_user_msg) return error.error_user_title ? `${error.error_user_title}: ${error.error_user_msg}` : error.error_user_msg;
  return error?.message || "Meta devolvió un error";
}

async function graphFetch<T>(url: URL, token: string): Promise<T> {
  url.searchParams.set("access_token", token);
  const proof = appSecretProof(token);
  if (proof) url.searchParams.set("appsecret_proof", proof);
  const response = await fetch(url, { cache: "no-store" });
  const body = (await response.json()) as T & { error?: GraphError };
  if (!response.ok || body.error) throw new Error(graphErrorMessage(body.error));
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
  const result = (await response.json()) as T & { error?: GraphError };
  if (!response.ok || result.error) throw new Error(graphErrorMessage(result.error));
  return result;
}

async function graphDelete(path: string, token: string): Promise<void> {
  const url = new URL(`${graphBase}/${path.replace(/^\//, "")}`);
  url.searchParams.set("access_token", token);
  const proof = appSecretProof(token);
  if (proof) url.searchParams.set("appsecret_proof", proof);
  const response = await fetch(url, { method: "DELETE" });
  const result = (await response.json().catch(() => ({}))) as { error?: GraphError };
  if (!response.ok || result.error) throw new Error(graphErrorMessage(result.error));
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
  is_prepay_account?: boolean;
  amount_spent?: string;
  spend_cap?: string;
  funding_source_details?: { display_string?: string };
}

// Meta returns amount_spent and spend_cap in the currency's minor units (cents for MXN).
function fundingFrom(account: MetaAdAccount): AccountFunding {
  const paymentMethod = account.funding_source_details?.display_string;
  return {
    prepaid: Boolean(account.is_prepay_account),
    paymentMethod,
    availableBalance: account.is_prepay_account ? parseAvailableBalance(paymentMethod) : undefined,
    amountSpent: Number(account.amount_spent || 0) / 100,
    spendCap: Number(account.spend_cap || 0) / 100,
    syncedAt: new Date().toISOString(),
  };
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
  creative?: {
    id: string;
    /** "pageId_postId" for boosted posts, which have no object_story_spec. */
    effective_object_story_id?: string;
    object_story_spec?: {
      page_id?: string;
      link_data?: { link?: string; message?: string; name?: string; image_hash?: string };
    };
  };
}

function adCreativeFrom(creative: MetaAd["creative"]): Ad["creative"] {
  if (!creative) return undefined;
  const spec = creative.object_story_spec;
  const linkData = spec?.link_data;
  return {
    id: creative.id,
    headline: linkData?.name,
    primaryText: linkData?.message,
    reusable: Boolean(spec?.page_id && linkData?.link && linkData.image_hash),
    spec: linkData ? JSON.stringify(spec) : undefined,
  };
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
  return graphGetAll<MetaAdAccount>("me/adaccounts", token, { fields: "id,name,currency,account_status,is_prepay_account,amount_spent,spend_cap,funding_source_details", limit: "100" });
}

const PAGE_FIELDS = "id,name,instagram_business_account{id,username}";

const toManagedPage = (page: MetaPage, source: ManagedPage["source"]): ManagedPage => ({
  id: page.id,
  name: page.name,
  instagramAccountId: page.instagram_business_account?.id,
  instagramHandle: page.instagram_business_account?.username ? `@${page.instagram_business_account.username}` : undefined,
  source,
});

/** Pages the profile can publish with: its own page roles plus the pages of the business portfolios it granted. */
export async function fetchManagedPages(token: string): Promise<ManagedPage[]> {
  const own = await graphGetAll<MetaPage>("me/accounts", token, { fields: PAGE_FIELDS, limit: "100" });
  const businesses = await graphGetAll<{ id: string }>("me/businesses", token, { fields: "id", limit: "50" }).catch(() => []);
  const portfolioPages = await Promise.all(businesses.flatMap((business) => ["owned_pages", "client_pages"].map((edge) =>
    // Portfolios not selected when connecting answer with a permission error; they are skipped.
    graphGetAll<MetaPage>(`${business.id}/${edge}`, token, { fields: PAGE_FIELDS, limit: "100" }).catch(() => [] as MetaPage[]))));
  return mergePages(
    own.map((page) => toManagedPage(page, "profile")),
    portfolioPages.flat().map((page) => toManagedPage(page, "business")),
  );
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
    const page = defaultPageFor(account.name, pages, previous?.pageId);
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
        fields: "id,name,effective_status,adset_id,campaign_id,creative{id,object_story_spec,effective_object_story_id}",
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
        creative: adCreativeFrom(ad.creative),
        pageId: pageIdFromCreative(ad.creative?.object_story_spec?.page_id, ad.creative?.effective_object_story_id),
      });
    }

    // One ad account often runs campaigns for several Pages; each campaign lists the Pages its ads use.
    for (const campaign of actualCampaigns) {
      if (campaign.organizationId === organizationId) campaign.pageIds = campaignPageIds(actualAds, campaign.id);
    }

    actualOrganizations.push({
      id: organizationId,
      name: account.name,
      initials: account.name.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase(),
      color: ["#7c5cff", "#f97349", "#13b981", "#2786ff"][index % 4],
      pageName: page?.name ?? previous?.pageName ?? "Página por vincular",
      pageId: page?.id ?? previous?.pageId,
      instagramHandle: page ? page.instagramHandle ?? "Instagram por vincular" : previous?.instagramHandle ?? "Instagram por vincular",
      instagramAccountId: page ? page.instagramAccountId : previous?.instagramAccountId,
      pixelId: pixelId || previous?.pixelId,
      adAccountId: account.id,
      currency: "MXN",
      objective: previous?.objective || "Ventas",
      mode: previous?.mode || "copilot",
      monthlyLimit: previous?.monthlyLimit || 50000,
      targetRoas: previous?.targetRoas,
      report: previous?.report,
      spentThisMonth: totalSpend,
      revenueThisMonth: totalRevenue,
      resultValue,
      connected: account.account_status === 1,
      funding: fundingFrom(account),
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
    organizations: actualOrganizations,
    campaigns: actualCampaigns,
    ads: actualAds,
    pages,
    metrics: actualMetrics,
  };
}

export type MessagingApp = "WHATSAPP" | "MESSENGER";

export interface MetaCampaignInput {
  objective: Organization["objective"];
  offer: string;
  headline: string;
  primaryText: string;
  dailyBudget: number;
  publish: boolean;
  /** Website for sales campaigns. */
  destination?: string;
  /** Instant form for lead campaigns. */
  leadFormId?: string;
  /** Conversation app for message campaigns. */
  messagingApp?: MessagingApp;
  image: { base64: string };
}

export interface CreatedMetaCampaign {
  campaignId: string;
  adSetId: string;
  status: "ACTIVE" | "PAUSED";
}

export const AD_SET_NAME = "Pulso · México · Audiencia Advantage+";

const CAMPAIGN_OBJECTIVES: Record<Organization["objective"], string> = {
  Ventas: "OUTCOME_SALES",
  Prospectos: "OUTCOME_LEADS",
  Mensajes: "OUTCOME_ENGAGEMENT",
};

interface ObjectiveSetup {
  adSet: Record<string, string>;
  link: string;
  callToAction: { type: string; value: Record<string, string> };
}

/** Objective-specific ad set and creative fields. Throws before anything is created in Meta. */
function objectiveSetup(organization: Organization, input: MetaCampaignInput): ObjectiveSetup {
  if (input.objective === "Ventas") {
    if (!organization.pixelId) throw new Error("Selecciona un Pixel/dataset con el evento Purchase antes de publicar");
    let destination: URL;
    try {
      destination = new URL(input.destination ?? "");
    } catch {
      throw new Error("Para campañas de ventas, el destino debe ser una URL válida");
    }
    return {
      adSet: {
        optimization_goal: "OFFSITE_CONVERSIONS",
        destination_type: "WEBSITE",
        promoted_object: JSON.stringify({ pixel_id: organization.pixelId, custom_event_type: "PURCHASE" }),
      },
      link: destination.toString(),
      callToAction: { type: "SHOP_NOW", value: { link: destination.toString() } },
    };
  }
  const pagePromotion = JSON.stringify({ page_id: organization.pageId });
  if (input.objective === "Prospectos") {
    if (!input.leadFormId) throw new Error("Elige un formulario instantáneo antes de publicar");
    return {
      adSet: { optimization_goal: "LEAD_GENERATION", destination_type: "ON_AD", promoted_object: pagePromotion },
      link: "http://fb.me/",
      callToAction: { type: "SIGN_UP", value: { lead_gen_form_id: input.leadFormId } },
    };
  }
  if (input.messagingApp === "WHATSAPP") {
    return {
      adSet: { optimization_goal: "CONVERSATIONS", destination_type: "WHATSAPP", promoted_object: pagePromotion },
      link: "https://api.whatsapp.com/send",
      callToAction: { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } },
    };
  }
  if (input.messagingApp === "MESSENGER") {
    return {
      adSet: { optimization_goal: "CONVERSATIONS", destination_type: "MESSENGER", promoted_object: pagePromotion },
      link: "https://fb.com/messenger_doc/",
      callToAction: { type: "MESSAGE_PAGE", value: { app_destination: "MESSENGER" } },
    };
  }
  throw new Error("Elige WhatsApp o Messenger para la campaña de mensajes");
}

/** Uploads the image to the ad account library and returns the hash creatives reference. */
async function uploadAdImage(adAccountId: string, token: string, base64: string): Promise<string> {
  const result = await graphPost<{ images?: Record<string, { hash: string }> }>(`${adAccountId}/adimages`, token, { bytes: base64 });
  const hash = Object.values(result.images ?? {})[0]?.hash;
  if (!hash) throw new Error("Meta no devolvió el identificador de la imagen");
  return hash;
}

/**
 * Creates campaign, ad set, image creative and ad, all paused, then activates them when `publish` is set.
 * If Meta rejects the ad set, creative or ad, the paused campaign is deleted so no empty campaign is left behind.
 * If only activation fails, everything stays paused so nothing spends by accident.
 */
export async function createMetaCampaign(
  encryptedToken: string,
  organization: Organization,
  input: MetaCampaignInput,
): Promise<CreatedMetaCampaign> {
  if (!organization.pageId) throw new Error("Selecciona una Página de Facebook antes de publicar");
  const setup = objectiveSetup(organization, input);
  const token = decryptSecret(encryptedToken);
  const imageHash = await uploadAdImage(organization.adAccountId, token, input.image.base64);
  const label = input.objective === "Mensajes" ? (input.messagingApp === "MESSENGER" ? "Messenger" : "WhatsApp") : input.objective;
  const campaign = await graphPost<{ id: string }>(`${organization.adAccountId}/campaigns`, token, {
    name: `Pulso · ${label} · ${input.offer}`,
    objective: CAMPAIGN_OBJECTIVES[input.objective],
    buying_type: "AUCTION",
    special_ad_categories: "[]",
    // Budget lives on the ad set, so the campaign does not share it across ad sets.
    is_adset_budget_sharing_enabled: "false",
    status: "PAUSED",
  });
  let adSet: { id: string };
  let ad: { id: string };
  try {
    adSet = await graphPost<{ id: string }>(`${organization.adAccountId}/adsets`, token, {
      name: AD_SET_NAME,
      campaign_id: campaign.id,
      daily_budget: Math.round(input.dailyBudget * 100),
      billing_event: "IMPRESSIONS",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      // Meta requires an explicit Advantage+ audience choice when creating ad sets.
      targeting: JSON.stringify({ geo_locations: { countries: ["MX"] }, age_min: 18, age_max: 65, targeting_automation: { advantage_audience: 1 } }),
      status: "PAUSED",
      ...setup.adSet,
    });
    const creative = await graphPost<{ id: string }>(`${organization.adAccountId}/adcreatives`, token, {
      name: `Pulso · Creative · ${input.offer}`,
      ...(organization.instagramAccountId ? { instagram_user_id: organization.instagramAccountId } : {}),
      object_story_spec: JSON.stringify({
        page_id: organization.pageId,
        link_data: {
          image_hash: imageHash,
          link: setup.link,
          message: input.primaryText,
          name: input.headline,
          call_to_action: setup.callToAction,
        },
      }),
    });
    ad = await graphPost<{ id: string }>(`${organization.adAccountId}/ads`, token, {
      name: `Pulso · ${input.offer} · Variante 1`,
      adset_id: adSet.id,
      creative: JSON.stringify({ creative_id: creative.id }),
      status: "PAUSED",
    });
  } catch (error) {
    // Nothing under this paused campaign can spend yet: remove it so a rejected attempt leaves no empty campaign.
    await graphDelete(campaign.id, token).catch((cleanupError) => console.error("Could not remove partial campaign", cleanupError));
    throw error;
  }
  if (input.publish) {
    await graphPost(campaign.id, token, { status: "ACTIVE" });
    await graphPost(adSet.id, token, { status: "ACTIVE" });
    await graphPost(ad.id, token, { status: "ACTIVE" });
  }
  return { campaignId: campaign.id, adSetId: adSet.id, status: input.publish ? "ACTIVE" : "PAUSED" };
}

export async function uploadAdImageWithToken(encryptedToken: string, adAccountId: string, base64: string): Promise<string> {
  return uploadAdImage(adAccountId, decryptSecret(encryptedToken), base64);
}

/** Creates a creative from a ready object_story_spec and an active ad with it in an existing ad set. */
export async function createAdVariant(
  encryptedToken: string,
  adAccountId: string,
  input: { adSetId: string; name: string; spec: string },
): Promise<string> {
  const token = decryptSecret(encryptedToken);
  const creative = await graphPost<{ id: string }>(`${adAccountId}/adcreatives`, token, {
    name: `Pulso · Variante · ${input.name}`,
    object_story_spec: input.spec,
  });
  const ad = await graphPost<{ id: string }>(`${adAccountId}/ads`, token, {
    name: input.name,
    adset_id: input.adSetId,
    creative: JSON.stringify({ creative_id: creative.id }),
    status: "ACTIVE",
  });
  return ad.id;
}

export interface LeadForm {
  id: string;
  name: string;
}

/** Active instant forms of a Page. Reading them needs a Page token, granted through pages_manage_ads. */
export async function listLeadForms(encryptedToken: string, pageId: string): Promise<LeadForm[]> {
  const token = decryptSecret(encryptedToken);
  const page = await graphGet<{ access_token?: string }>(pageId, token, { fields: "access_token" });
  if (!page.access_token) throw new Error("No tienes permiso para administrar anuncios de esta Página. Vuelve a conectar Meta.");
  const forms = await graphGetAll<{ id: string; name: string; status?: string }>(`${pageId}/leadgen_forms`, page.access_token, {
    fields: "id,name,status",
    limit: "100",
  });
  return forms.filter((form) => !form.status || form.status === "ACTIVE").map(({ id, name }) => ({ id, name }));
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
