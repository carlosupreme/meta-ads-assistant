import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adSetName, buildTargeting, DEFAULT_AUDIENCE, describeAudience, normalizeAudience } from "../lib/targeting.ts";
import type { AudienceSpec } from "../lib/types.ts";

const audience = (overrides: Partial<AudienceSpec> = {}): AudienceSpec => ({ ...DEFAULT_AUDIENCE, ...overrides });

describe("audience targeting", () => {
  it("keeps Advantage+ age range and interests as suggestions and leaves gender to Meta", () => {
    const targeting = buildTargeting(audience({
      ageMin: 30, ageMax: 45, genders: "female",
      locations: [{ key: "2673660", name: "Oaxaca de Juárez", type: "city" }, { key: "3100", name: "Puebla", type: "region" }],
      interests: [{ id: "600", name: "Decoración" }],
    }));
    assert.deepEqual(targeting, {
      geo_locations: { regions: [{ key: "3100" }], cities: [{ key: "2673660", radius: 17, distance_unit: "kilometer" }] },
      age_min: 25,
      age_max: 65,
      age_range: [30, 45],
      flexible_spec: [{ interests: [{ id: "600", name: "Decoración" }] }],
      targeting_automation: { advantage_audience: 1 },
    });
  });

  it("applies ages and gender as hard limits for an exact audience", () => {
    const targeting = buildTargeting(audience({ advantage: false, ageMin: 30, ageMax: 45, genders: "male" }));
    assert.deepEqual(targeting, {
      geo_locations: { countries: ["MX"] }, age_min: 30, age_max: 45, genders: [1], targeting_automation: { advantage_audience: 0 },
    });
  });

  it("repairs ages out of range, repeated items and an empty place list", () => {
    const fixed = normalizeAudience(audience({ ageMin: 70, ageMax: 20, locations: [], interests: [{ id: "1", name: "A" }, { id: "1", name: "A" }] }));
    assert.equal(fixed.ageMin, 65);
    assert.equal(fixed.ageMax, 65);
    assert.equal(fixed.locations[0].key, "MX");
    assert.equal(fixed.interests.length, 1);
  });

  it("describes and names the audience", () => {
    assert.equal(describeAudience(audience({ advantage: false, genders: "female", ageMin: 25, ageMax: 40 })), "México · 25–40 años · mujeres");
    assert.equal(adSetName(audience()), "Pulso · México · Advantage+");
  });
});
