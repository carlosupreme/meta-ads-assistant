// Pure analysis of organic Page posts: engagement, best time to publish, formats and findings.
// Type-only imports so it runs under `node --test`.
import type { PagePost, PostFormat } from "./types";

const TIME_ZONE = "America/Mexico_City";
const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

/** Time blocks people recognize, rather than 24 separate hours that never gather enough posts. */
const TIME_BLOCKS: Array<{ key: string; label: string; from: number; to: number }> = [
  { key: "madrugada", label: "Madrugada (0–5 h)", from: 0, to: 5 },
  { key: "manana", label: "Mañana (6–11 h)", from: 6, to: 11 },
  { key: "mediodia", label: "Mediodía (12–14 h)", from: 12, to: 14 },
  { key: "tarde", label: "Tarde (15–19 h)", from: 15, to: 19 },
  { key: "noche", label: "Noche (20–23 h)", from: 20, to: 23 },
];

export const FORMAT_LABELS: Record<PostFormat, string> = {
  photo: "Foto",
  video: "Video",
  reel: "Reel",
  album: "Álbum",
  link: "Enlace",
  status: "Solo texto",
  other: "Otro",
};

/** Reactions, comments and shares: what a Page owner counts as interaction. */
export const postEngagement = (post: PagePost) => post.reactions + post.comments + post.shares;

const localParts = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "short", hour: "2-digit", hour12: false }).formatToParts(date);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const index = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  return index < 0 ? undefined : { weekday: index, hour: hour % 24 };
};

export interface PostStats {
  posts: number;
  reactions: number;
  comments: number;
  shares: number;
  engagement: number;
  reach: number;
  impressions: number;
  averageEngagement: number;
  /** Engagement over reach, when Meta reports reach for these posts. */
  engagementRate: number | null;
}

export function summarizePosts(posts: PagePost[]): PostStats {
  const totals = posts.reduce((sum, post) => ({
    reactions: sum.reactions + post.reactions,
    comments: sum.comments + post.comments,
    shares: sum.shares + post.shares,
    reach: sum.reach + (post.reach ?? 0),
    impressions: sum.impressions + (post.impressions ?? 0),
  }), { reactions: 0, comments: 0, shares: 0, reach: 0, impressions: 0 });
  const engagement = totals.reactions + totals.comments + totals.shares;
  return {
    ...totals,
    posts: posts.length,
    engagement,
    averageEngagement: posts.length ? engagement / posts.length : 0,
    engagementRate: totals.reach ? engagement / totals.reach : null,
  };
}

export interface PostBucket {
  key: string;
  label: string;
  posts: number;
  engagement: number;
  /** Average interactions per post: the only fair way to compare buckets with different post counts. */
  average: number;
}

function bucket(posts: PagePost[], key: (post: PagePost) => { key: string; label: string } | undefined): PostBucket[] {
  const groups = new Map<string, { label: string; posts: PagePost[] }>();
  for (const post of posts) {
    const group = key(post);
    if (!group) continue;
    const current = groups.get(group.key);
    if (current) current.posts.push(post);
    else groups.set(group.key, { label: group.label, posts: [post] });
  }
  return [...groups.entries()]
    .map(([groupKey, group]) => {
      const engagement = group.posts.reduce((sum, post) => sum + postEngagement(post), 0);
      return { key: groupKey, label: group.label, posts: group.posts.length, engagement, average: engagement / group.posts.length };
    })
    .sort((a, b) => b.average - a.average);
}

export const byWeekday = (posts: PagePost[]) => bucket(posts, (post) => {
  const parts = localParts(post.createdAt);
  return parts ? { key: String(parts.weekday), label: WEEKDAYS[parts.weekday] } : undefined;
});

export const byTimeBlock = (posts: PagePost[]) => bucket(posts, (post) => {
  const parts = localParts(post.createdAt);
  const block = parts && TIME_BLOCKS.find((item) => parts.hour >= item.from && parts.hour <= item.to);
  return block ? { key: block.key, label: block.label } : undefined;
});

export const byFormat = (posts: PagePost[]) => bucket(posts, (post) => ({ key: post.format, label: FORMAT_LABELS[post.format] }));

export const topPosts = (posts: PagePost[], count = 5) => [...posts].sort((a, b) => postEngagement(b) - postEngagement(a)).slice(0, count);

/** Buckets with enough posts to mean something; one lucky post should not set the schedule. */
export const reliable = (buckets: PostBucket[], minimum = 3) => buckets.filter((item) => item.posts >= minimum);

const DAY_MS = 86_400_000;

export interface PostFinding {
  kind: "good" | "warn" | "info";
  title: string;
  detail: string;
}

/** Plain-language findings from the posts themselves, before any AI is involved. */
export function postFindings(posts: PagePost[], now: Date): PostFinding[] {
  if (!posts.length) return [{ kind: "info", title: "Aún no hay publicaciones", detail: "Sincroniza tu página para analizar lo que publicas sin pauta." }];
  const findings: PostFinding[] = [];
  const stats = summarizePosts(posts);
  const sorted = [...posts].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const newest = Date.parse(sorted[0].createdAt);
  const oldest = Date.parse(sorted[sorted.length - 1].createdAt);
  const days = Math.max(1, Math.round((now.getTime() - oldest) / DAY_MS));
  const perWeek = (posts.length / days) * 7;
  const silentDays = Math.floor((now.getTime() - newest) / DAY_MS);

  findings.push(silentDays >= 14
    ? { kind: "warn", title: `Llevas ${silentDays} días sin publicar`, detail: "Las páginas que publican cada semana mantienen alcance sin pagar. Retoma con lo que mejor te funcionó." }
    : { kind: "info", title: `Publicas ${perWeek.toFixed(1)} veces por semana`, detail: `${posts.length} publicaciones en los últimos ${days} días, con ${Math.round(stats.averageEngagement)} interacciones en promedio.` });

  const [bestDay] = reliable(byWeekday(posts));
  const [bestBlock] = reliable(byTimeBlock(posts));
  if (bestDay && bestBlock) {
    findings.push({
      kind: "good",
      title: `Tu mejor momento: ${bestDay.label} por la ${bestBlock.label.split(" ")[0].toLowerCase()}`,
      detail: `Los ${bestDay.label.toLowerCase()} promedian ${Math.round(bestDay.average)} interacciones y el bloque ${bestBlock.label.toLowerCase()} ${Math.round(bestBlock.average)}, contra ${Math.round(stats.averageEngagement)} del promedio general.`,
    });
  }

  const formats = reliable(byFormat(posts), 2);
  if (formats.length >= 2) {
    const [best, ...rest] = formats;
    const worst = rest[rest.length - 1];
    findings.push({
      kind: "good",
      title: `${best.label} es tu formato más fuerte`,
      detail: `Promedia ${Math.round(best.average)} interacciones por publicación, frente a ${Math.round(worst.average)} de ${worst.label.toLowerCase()}.`,
    });
  }

  const [top] = topPosts(posts, 1);
  if (top && postEngagement(top) > stats.averageEngagement * 2) {
    findings.push({
      kind: "good",
      title: "Una publicación se salió de la media",
      detail: `"${(top.message ?? "Sin texto").slice(0, 80)}" logró ${postEngagement(top)} interacciones. Vale la pena repetir ese tema o promocionarla con pauta.`,
    });
  }

  const withoutMedia = posts.filter((post) => post.format === "status" || post.format === "link").length;
  if (withoutMedia / posts.length > 0.4) {
    findings.push({
      kind: "warn",
      title: "Muchas publicaciones sin foto ni video",
      detail: `${withoutMedia} de ${posts.length} son solo texto o enlace. En Facebook e Instagram las piezas con imagen o video suelen alcanzar a más gente.`,
    });
  }

  const recent = posts.filter((post) => now.getTime() - Date.parse(post.createdAt) <= 30 * DAY_MS);
  const previous = posts.filter((post) => {
    const age = now.getTime() - Date.parse(post.createdAt);
    return age > 30 * DAY_MS && age <= 60 * DAY_MS;
  });
  if (recent.length >= 3 && previous.length >= 3) {
    const recentAverage = summarizePosts(recent).averageEngagement;
    const previousAverage = summarizePosts(previous).averageEngagement;
    const change = previousAverage ? ((recentAverage - previousAverage) / previousAverage) * 100 : 0;
    if (Math.abs(change) >= 15) {
      findings.push({
        kind: change > 0 ? "good" : "warn",
        title: `Tus publicaciones ${change > 0 ? "están gustando más" : "están gustando menos"} (${change > 0 ? "+" : ""}${change.toFixed(0)}%)`,
        detail: `Últimos 30 días: ${Math.round(recentAverage)} interacciones por publicación, contra ${Math.round(previousAverage)} del mes anterior.`,
      });
    }
  }

  return findings;
}
