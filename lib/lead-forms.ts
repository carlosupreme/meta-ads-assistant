// Pure instant form helpers: validation and the parameters Meta's leadgen_forms endpoint takes. No imports, so it runs under `node --test`.

export interface LeadFormQuestion {
  label: string;
  /** Multiple choice answers; without them the question takes a free answer. */
  options?: string[];
}

export interface LeadFormInput {
  name: string;
  headline: string;
  description: string;
  fields: { fullName: boolean; email: boolean; phone: boolean; city: boolean };
  customQuestions: LeadFormQuestion[];
  /** Adds a review step before sending: fewer leads, more intent. */
  higherIntent: boolean;
  privacyPolicyUrl: string;
  privacyLinkText?: string;
  thankYouTitle: string;
  thankYouBody: string;
  websiteUrl?: string;
}

export const MAX_CUSTOM_QUESTIONS = 3;

const STANDARD_QUESTIONS: Array<[keyof LeadFormInput["fields"], string]> = [
  ["fullName", "FULL_NAME"],
  ["email", "EMAIL"],
  ["phone", "PHONE"],
  ["city", "CITY"],
];

function isHttpUrl(value: string | undefined): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value ?? "").protocol);
  } catch {
    return false;
  }
}

/** "Chica, Mediana,  Grande," → ["Chica", "Mediana", "Grande"]; nothing written means a free answer. */
export function parseOptions(text: string): string[] | undefined {
  const options = text.split(",").map((option) => option.trim()).filter(Boolean);
  return options.length ? options : undefined;
}

/** What still blocks creating the form, in words for the business owner, or null when it is ready. */
export function leadFormProblem(input: LeadFormInput): string | null {
  if (input.name.trim().length < 3) return "Ponle un nombre al formulario.";
  if (input.headline.trim().length < 3) return "Escribe el título de bienvenida.";
  if (!input.fields.email && !input.fields.phone) return "Pide al menos correo o teléfono para poder contactar a tus prospectos.";
  if (input.customQuestions.some((question) => question.label.trim().length < 3)) return "Completa o quita las preguntas vacías.";
  if (input.customQuestions.some((question) => question.options?.length === 1)) return "Una pregunta de opción múltiple necesita al menos dos opciones.";
  if (!isHttpUrl(input.privacyPolicyUrl)) return "Meta exige el enlace a tu aviso de privacidad (una URL que empiece con https://).";
  if (input.thankYouTitle.trim().length < 3 || input.thankYouBody.trim().length < 3) return "Completa el mensaje de agradecimiento.";
  if (input.websiteUrl && !isHttpUrl(input.websiteUrl)) return "El sitio web del agradecimiento debe ser una URL válida.";
  return null;
}

/** Form fields for POST /{page_id}/leadgen_forms, with nested objects JSON-encoded as Graph expects. */
export function buildLeadFormParams(input: LeadFormInput): Record<string, string> {
  const questions = [
    ...STANDARD_QUESTIONS.filter(([field]) => input.fields[field]).map(([, type]) => ({ type, key: type.toLowerCase() })),
    ...input.customQuestions.slice(0, MAX_CUSTOM_QUESTIONS).map((question, index) => ({
      type: "CUSTOM",
      key: `pregunta_${index + 1}`,
      label: question.label.trim(),
      ...(question.options?.length && { options: question.options.map((value, option) => ({ value, key: `pregunta_${index + 1}_opcion_${option + 1}` })) }),
    })),
  ];
  const website = input.websiteUrl?.trim();
  return {
    name: input.name.trim(),
    locale: "ES_LA",
    questions: JSON.stringify(questions),
    privacy_policy: JSON.stringify({ url: input.privacyPolicyUrl.trim(), link_text: input.privacyLinkText?.trim() || "Aviso de privacidad" }),
    context_card: JSON.stringify({ title: input.headline.trim(), style: "PARAGRAPH_STYLE", content: [input.description.trim() || input.headline.trim()] }),
    thank_you_page: JSON.stringify(website
      ? { title: input.thankYouTitle.trim(), body: input.thankYouBody.trim(), button_type: "VIEW_WEBSITE", button_text: "Visitar sitio web", website_url: website }
      : { title: input.thankYouTitle.trim(), body: input.thankYouBody.trim(), button_type: "VIEW_ON_FACEBOOK", button_text: "Ver página" }),
    is_optimized_for_quality: String(input.higherIntent),
  };
}
