// Pure audience helpers: the targeting spec sent to Meta and its description. Type-only imports so it runs under `node --test`.
import type { AudienceSpec, TargetLocation } from "./types";

export const DEFAULT_AUDIENCE: AudienceSpec = {
  advantage: true,
  ageMin: 18,
  ageMax: 65,
  genders: "all",
  locations: [{ key: "MX", name: "México", type: "country" }],
  interests: [],
};

/** While Advantage+ audience is on, Meta accepts a hard minimum age of at most 25; the rest of the range is a suggestion. */
const ADVANTAGE_MAX_AGE_MIN = 25;
const CITY_RADIUS_KM = 17;
const MAX_ITEMS = 25;

const clampAge = (value: number) => Math.min(65, Math.max(18, Math.round(Number.isFinite(value) ? value : 18)));

function unique<T>(items: T[], key: (item: T) => string): T[] {
  return [...new Map(items.map((item) => [key(item), item])).values()];
}

/** Ages within Meta's 18–65 range in order, without repeated places or interests, and at least one place. */
export function normalizeAudience(audience: AudienceSpec): AudienceSpec {
  const ageMin = clampAge(audience.ageMin);
  const ageMax = Math.max(ageMin, clampAge(audience.ageMax));
  const locations = unique(audience.locations, (location) => `${location.type}:${location.key}`).slice(0, MAX_ITEMS);
  return {
    ...audience,
    ageMin,
    ageMax,
    locations: locations.length ? locations : DEFAULT_AUDIENCE.locations,
    interests: unique(audience.interests, (interest) => interest.id).slice(0, MAX_ITEMS),
  };
}

/** Ad set `targeting` for Meta. Advantage+ turns age range and interests into suggestions and leaves gender to Meta. */
export function buildTargeting(input: AudienceSpec): Record<string, unknown> {
  const audience = normalizeAudience(input);
  const ofType = (type: TargetLocation["type"]) => audience.locations.filter((location) => location.type === type);
  const [countries, regions, cities] = [ofType("country"), ofType("region"), ofType("city")];
  const geoLocations = {
    ...(countries.length > 0 && { countries: countries.map((location) => location.key) }),
    ...(regions.length > 0 && { regions: regions.map((location) => ({ key: location.key })) }),
    ...(cities.length > 0 && { cities: cities.map((location) => ({ key: location.key, radius: CITY_RADIUS_KM, distance_unit: "kilometer" })) }),
  };
  const interests = audience.interests.length > 0
    ? { flexible_spec: [{ interests: audience.interests.map(({ id, name }) => ({ id, name })) }] }
    : {};

  if (audience.advantage) {
    const narrowed = audience.ageMin > 18 || audience.ageMax < 65;
    return {
      geo_locations: geoLocations,
      age_min: Math.min(audience.ageMin, ADVANTAGE_MAX_AGE_MIN),
      age_max: 65,
      ...(narrowed && { age_range: [audience.ageMin, audience.ageMax] }),
      ...interests,
      targeting_automation: { advantage_audience: 1 },
    };
  }
  return {
    geo_locations: geoLocations,
    age_min: audience.ageMin,
    age_max: audience.ageMax,
    ...(audience.genders !== "all" && { genders: [audience.genders === "male" ? 1 : 2] }),
    ...interests,
    targeting_automation: { advantage_audience: 0 },
  };
}

export function describeAudience(input: AudienceSpec): string {
  const audience = normalizeAudience(input);
  const genders = audience.genders === "male" ? "hombres" : audience.genders === "female" ? "mujeres" : "todos los géneros";
  const parts = [
    audience.locations.map((location) => location.name).join(", "),
    `${audience.ageMin}–${audience.ageMax}${audience.ageMax === 65 ? "+" : ""} años`,
    audience.advantage ? "Advantage+ (Meta puede ampliar)" : genders,
  ];
  if (audience.interests.length) parts.push(`intereses: ${audience.interests.map((interest) => interest.name).join(", ")}`);
  return parts.join(" · ");
}

/** Short ad set name, e.g. "Pulso · Oaxaca, Puebla · 25–45". */
export function adSetName(input: AudienceSpec): string {
  const audience = normalizeAudience(input);
  const places = audience.locations.slice(0, 2).map((location) => location.name).join(", ") + (audience.locations.length > 2 ? " y más" : "");
  const reach = audience.advantage ? "Advantage+" : `${audience.ageMin}–${audience.ageMax}`;
  return `Pulso · ${places} · ${reach}`.slice(0, 100);
}
