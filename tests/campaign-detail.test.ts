import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adsManagerUrl, describeTargeting, formatSchedule, isPreviewFormat, labelOr, OBJECTIVE_LABELS } from "../lib/campaign-detail.ts";

describe("campaign detail", () => {
  it("reads an Advantage+ targeting spec", () => {
    const summary = describeTargeting({
      age_min: 18,
      age_max: 65,
      age_range: [25, 45],
      genders: [2],
      geo_locations: {
        countries: ["MX"],
        regions: [{ key: "3100", name: "Oaxaca" }],
        cities: [{ key: "2673660", name: "Oaxaca de Juárez", region: "Oaxaca", radius: 17, distance_unit: "kilometer" }],
      },
      flexible_spec: [{ interests: [{ id: "6003", name: "Fútbol" }] }],
      exclusions: { interests: [{ id: "6004", name: "Ropa usada" }] },
      publisher_platforms: ["facebook", "instagram"],
      locales: [23],
      targeting_automation: { advantage_audience: 1 },
    });
    assert.equal(summary.ages, "18 a 65 años (sugerido 25 a 45)");
    assert.equal(summary.genders, "Mujeres");
    assert.deepEqual(summary.locations, ["MX (país)", "Oaxaca (estado)", "Oaxaca de Juárez, Oaxaca (ciudad) · 17 km a la redonda"]);
    assert.deepEqual(summary.interests, ["Fútbol"]);
    assert.deepEqual(summary.exclusions, ["Ropa usada"]);
    assert.equal(summary.placements, "Facebook, Instagram");
    assert.equal(summary.advantage, true);
  });

  it("survives a spec with nothing in it", () => {
    const summary = describeTargeting(undefined);
    assert.equal(summary.ages, "18 a 65 años");
    assert.equal(summary.genders, "Todos los géneros");
    assert.equal(summary.placements, "Automáticas (Advantage+)");
    assert.deepEqual(summary.locations, []);
    assert.equal(summary.advantage, false);
  });

  it("puts Meta's codes and dates in words", () => {
    assert.equal(labelOr(OBJECTIVE_LABELS, "OUTCOME_SALES"), "Ventas");
    assert.equal(labelOr(OBJECTIVE_LABELS, "OTRA_COSA"), "otra cosa");
    assert.equal(labelOr(OBJECTIVE_LABELS, undefined), "—");
    // Month abbreviations depend on the ICU build ("sep" or "sept").
    assert.match(formatSchedule("2026-09-12T10:00:00-0600", undefined), /^Desde el 12 sep\.?t? 2026, sin fecha de fin$/);
    assert.equal(formatSchedule(undefined, undefined), "Sin fechas definidas");
    assert.ok(isPreviewFormat("INSTAGRAM_STORY"));
    assert.equal(isPreviewFormat("TIKTOK"), false);
    assert.equal(adsManagerUrl("act_123", "456"), "https://adsmanager.facebook.com/adsmanager/manage/ads?act=123&selected_campaign_ids=456");
  });
});
