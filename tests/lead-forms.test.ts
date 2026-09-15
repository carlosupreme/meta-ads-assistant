import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildLeadFormParams, leadFormProblem, parseOptions, type LeadFormInput } from "../lib/lead-forms.ts";

const input = (overrides: Partial<LeadFormInput> = {}): LeadFormInput => ({
  name: "Pulso · Uniformes",
  headline: "Cotiza uniformes para tu equipo",
  description: "Déjanos tus datos y te enviamos la cotización hoy.",
  fields: { fullName: true, email: false, phone: true, city: false },
  customQuestions: [],
  higherIntent: false,
  privacyPolicyUrl: "https://negocio.mx/privacidad",
  thankYouTitle: "¡Gracias!",
  thankYouBody: "Te escribimos por WhatsApp muy pronto.",
  ...overrides,
});

describe("instant forms", () => {
  it("builds questions, intro, privacy and thank you page for Meta", () => {
    const params = buildLeadFormParams(input({
      customQuestions: [{ label: "¿Cuántos uniformes necesitas?", options: ["1 a 10", "Más de 10"] }, { label: "¿Qué deporte?" }],
      higherIntent: true,
    }));
    assert.deepEqual(JSON.parse(params.questions), [
      { type: "FULL_NAME", key: "full_name" },
      { type: "PHONE", key: "phone" },
      { type: "CUSTOM", key: "pregunta_1", label: "¿Cuántos uniformes necesitas?", options: [{ value: "1 a 10", key: "pregunta_1_opcion_1" }, { value: "Más de 10", key: "pregunta_1_opcion_2" }] },
      { type: "CUSTOM", key: "pregunta_2", label: "¿Qué deporte?" },
    ]);
    assert.deepEqual(JSON.parse(params.privacy_policy), { url: "https://negocio.mx/privacidad", link_text: "Aviso de privacidad" });
    assert.deepEqual(JSON.parse(params.context_card), { title: "Cotiza uniformes para tu equipo", style: "PARAGRAPH_STYLE", content: ["Déjanos tus datos y te enviamos la cotización hoy."] });
    assert.equal(JSON.parse(params.thank_you_page).button_type, "VIEW_ON_FACEBOOK");
    assert.equal(params.is_optimized_for_quality, "true");
    assert.equal(params.locale, "ES_LA");
  });

  it("links the thank you page to the website when there is one", () => {
    const page = JSON.parse(buildLeadFormParams(input({ websiteUrl: "https://negocio.mx" })).thank_you_page);
    assert.equal(page.button_type, "VIEW_WEBSITE");
    assert.equal(page.website_url, "https://negocio.mx");
  });

  it("explains what blocks the form", () => {
    assert.equal(leadFormProblem(input()), null);
    assert.match(leadFormProblem(input({ privacyPolicyUrl: "" })) ?? "", /aviso de privacidad/);
    assert.match(leadFormProblem(input({ fields: { fullName: true, email: false, phone: false, city: true } })) ?? "", /correo o teléfono/);
    assert.match(leadFormProblem(input({ customQuestions: [{ label: "¿Talla?", options: ["M"] }] })) ?? "", /dos opciones/);
  });

  it("reads comma separated options", () => {
    assert.deepEqual(parseOptions("Chica, Mediana,  Grande,"), ["Chica", "Mediana", "Grande"]);
    assert.equal(parseOptions("  "), undefined);
  });
});
