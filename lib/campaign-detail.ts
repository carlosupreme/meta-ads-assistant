// Pure translations of Meta's campaign setup into what a business owner reads. No imports, so it runs under `node --test`.

export interface TargetingSummary {
  ages: string;
  genders: string;
  locations: string[];
  interests: string[];
  exclusions: string[];
  languages: string[];
  placements: string;
  advantage: boolean;
}

/** Ad preview formats offered in the app, with the size Meta's iframe needs. */
export const PREVIEW_FORMATS = [
  { key: "MOBILE_FEED_STANDARD", label: "Feed móvil", width: 340, height: 620 },
  { key: "DESKTOP_FEED_STANDARD", label: "Feed escritorio", width: 560, height: 680 },
  { key: "INSTAGRAM_STANDARD", label: "Instagram", width: 340, height: 620 },
  { key: "INSTAGRAM_STORY", label: "Historias", width: 340, height: 620 },
  { key: "INSTAGRAM_REELS", label: "Reels", width: 340, height: 620 },
] as const;

export type PreviewFormat = (typeof PREVIEW_FORMATS)[number]["key"];

export const isPreviewFormat = (value: string): value is PreviewFormat => PREVIEW_FORMATS.some((format) => format.key === value);

/** Why Meta is or is not delivering, in plain Spanish. */
export const DELIVERY_STATUS: Record<string, { label: string; tone: "good" | "warn" | "muted" }> = {
  ACTIVE: { label: "Entregando", tone: "good" },
  PAUSED: { label: "En pausa", tone: "muted" },
  CAMPAIGN_PAUSED: { label: "Campaña en pausa", tone: "muted" },
  ADSET_PAUSED: { label: "Conjunto en pausa", tone: "muted" },
  PENDING_REVIEW: { label: "En revisión de Meta", tone: "warn" },
  IN_PROCESS: { label: "Preparándose", tone: "warn" },
  PREAPPROVED: { label: "Aprobada previamente", tone: "warn" },
  PENDING_BILLING_INFO: { label: "Falta información de pago", tone: "warn" },
  DISAPPROVED: { label: "Rechazada por Meta", tone: "warn" },
  WITH_ISSUES: { label: "Con problemas", tone: "warn" },
  ARCHIVED: { label: "Archivada", tone: "muted" },
  DELETED: { label: "Eliminada", tone: "muted" },
  ADSET_DELETED: { label: "Conjunto eliminado", tone: "muted" },
  CAMPAIGN_DELETED: { label: "Campaña eliminada", tone: "muted" },
};

export const OBJECTIVE_LABELS: Record<string, string> = {
  OUTCOME_SALES: "Ventas",
  OUTCOME_LEADS: "Prospectos",
  OUTCOME_ENGAGEMENT: "Interacción y mensajes",
  OUTCOME_TRAFFIC: "Tráfico",
  OUTCOME_AWARENESS: "Reconocimiento",
  OUTCOME_APP_PROMOTION: "Promoción de app",
  CONVERSIONS: "Conversiones",
  LINK_CLICKS: "Clics en el enlace",
  POST_ENGAGEMENT: "Interacción con la publicación",
  PAGE_LIKES: "Me gusta de la página",
  LEAD_GENERATION: "Prospectos",
  MESSAGES: "Mensajes",
  VIDEO_VIEWS: "Reproducciones de video",
  REACH: "Alcance",
  BRAND_AWARENESS: "Reconocimiento de marca",
};

export const OPTIMIZATION_LABELS: Record<string, string> = {
  OFFSITE_CONVERSIONS: "Conversiones en tu sitio",
  LEAD_GENERATION: "Prospectos",
  QUALITY_LEAD: "Prospectos de calidad",
  CONVERSATIONS: "Conversaciones",
  LINK_CLICKS: "Clics en el enlace",
  LANDING_PAGE_VIEWS: "Vistas de la página de destino",
  POST_ENGAGEMENT: "Interacción",
  PAGE_LIKES: "Me gusta de la página",
  REACH: "Alcance",
  IMPRESSIONS: "Impresiones",
  THRUPLAY: "Reproducciones de video",
  VALUE: "Valor de compra",
  APP_INSTALLS: "Instalaciones",
};

export const BILLING_LABELS: Record<string, string> = {
  IMPRESSIONS: "Por impresiones",
  LINK_CLICKS: "Por clics en el enlace",
  THRUPLAY: "Por reproducciones",
  PAGE_LIKES: "Por me gusta",
  POST_ENGAGEMENT: "Por interacción",
};

export const BID_STRATEGY_LABELS: Record<string, string> = {
  LOWEST_COST_WITHOUT_CAP: "Mayor volumen, sin tope de puja",
  LOWEST_COST_WITH_BID_CAP: "Con tope de puja",
  COST_CAP: "Con tope de costo",
  LOWEST_COST_WITH_MIN_ROAS: "Con ROAS mínimo",
};

export const DESTINATION_LABELS: Record<string, string> = {
  WEBSITE: "Tu sitio web",
  ON_AD: "Formulario instantáneo",
  WHATSAPP: "WhatsApp",
  MESSENGER: "Messenger",
  INSTAGRAM_DIRECT: "Instagram Direct",
  PHONE_CALL: "Llamada telefónica",
  ON_POST: "La publicación",
  APP: "Tu app",
};

const PLATFORM_LABELS: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  audience_network: "Audience Network",
  messenger: "Messenger",
  threads: "Threads",
};

const LOCATION_KIND: Record<string, string> = {
  countries: "país",
  regions: "estado",
  cities: "ciudad",
  zips: "código postal",
  geo_markets: "zona",
  places: "lugar",
};

export const labelOr = (labels: Record<string, string>, key: string | undefined, fallback = "—") =>
  (key ? labels[key] ?? key.replaceAll("_", " ").toLowerCase() : fallback);

const asRecord = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asText = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);

function placeNames(geo: Record<string, unknown>): string[] {
  return Object.entries(LOCATION_KIND).flatMap(([field, kind]) => asArray(geo[field]).flatMap((entry) => {
    if (typeof entry === "string") return [`${entry} (${kind})`];
    const place = asRecord(entry);
    const name = asText(place.name) ?? asText(place.key);
    if (!name) return [];
    const radius = typeof place.radius === "number" ? ` · ${place.radius} ${place.distance_unit === "mile" ? "mi" : "km"} a la redonda` : "";
    const region = asText(place.region);
    return [`${name}${region && region !== name ? `, ${region}` : ""} (${kind})${radius}`];
  }));
}

function interestNames(spec: Record<string, unknown>): string[] {
  const groups = [...asArray(spec.flexible_spec).map(asRecord), spec];
  const names = groups.flatMap((group) => ["interests", "behaviors", "life_events", "industries", "work_positions"]
    .flatMap((field) => asArray(group[field]).map((entry) => asText(asRecord(entry).name)).filter((name): name is string => Boolean(name))));
  return [...new Set(names)];
}

/** What Meta will actually target, read from the ad set's targeting spec. */
export function describeTargeting(raw: unknown): TargetingSummary {
  const spec = asRecord(raw);
  const geo = asRecord(spec.geo_locations);
  const automation = asRecord(spec.targeting_automation);
  const ageRange = asArray(spec.age_range).filter((value): value is number => typeof value === "number");
  const ageMin = typeof spec.age_min === "number" ? spec.age_min : ageRange[0] ?? 18;
  const ageMax = typeof spec.age_max === "number" ? spec.age_max : ageRange[1] ?? 65;
  const suggested = ageRange.length === 2 && (ageRange[0] !== ageMin || ageRange[1] !== ageMax);
  const genders = asArray(spec.genders).filter((value): value is number => typeof value === "number");
  const platforms = asArray(spec.publisher_platforms).map(asText).filter((value): value is string => Boolean(value));
  const exclusions = [
    ...interestNames(asRecord(spec.exclusions)),
    ...placeNames(asRecord(spec.excluded_geo_locations)),
  ];

  return {
    ages: `${ageMin} a ${ageMax} años${suggested ? ` (sugerido ${ageRange[0]} a ${ageRange[1]})` : ""}`,
    genders: genders.length === 1 ? (genders[0] === 1 ? "Hombres" : "Mujeres") : "Todos los géneros",
    locations: placeNames(geo),
    interests: interestNames(spec),
    exclusions,
    languages: asArray(spec.locales).map((value) => String(value)),
    placements: platforms.length ? platforms.map((platform) => PLATFORM_LABELS[platform] ?? platform).join(", ") : "Automáticas (Advantage+)",
    advantage: automation.advantage_audience === 1 || automation.advantage_audience === "1",
  };
}

/** "Del 12 sept 2026 al 30 sept 2026", or open-ended when Meta has no end date. */
export function formatSchedule(start: string | undefined, end: string | undefined): string {
  const date = (value: string | undefined) => {
    if (!value) return undefined;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric" }).format(parsed);
  };
  const from = date(start);
  const to = date(end);
  if (from && to) return `Del ${from} al ${to}`;
  if (from) return `Desde el ${from}, sin fecha de fin`;
  return to ? `Hasta el ${to}` : "Sin fechas definidas";
}

/** Deep link to this campaign in Meta's Ads Manager. */
export function adsManagerUrl(adAccountId: string, campaignId: string): string {
  const account = adAccountId.startsWith("act_") ? adAccountId.slice(4) : adAccountId;
  return `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${account}&selected_campaign_ids=${campaignId}`;
}
