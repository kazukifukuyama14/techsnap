import type { Formality, TargetLanguageCode } from "deepl-node";

export type SummarizerConfig = {
  projectId: string;
  feeds: string[];
  maxItems: number;
  concurrency: number;
  fetchTimeoutMs: number;
  openAi: {
    apiKey: string;
    model: string;
    systemPrompt: string;
  };
  deepl: {
    apiKey: string;
    targetLang: TargetLanguageCode;
    formality?: Formality;
  };
};

const DEFAULT_SYSTEM_PROMPT =
  "You are a helpful assistant that summarizes technical articles for software engineers. Generate a concise summary (<= 120 Japanese characters) highlighting the key takeaways.";

export function loadConfig(): SummarizerConfig {
  const projectId =
    process.env.GCP_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT;
  if (!projectId) {
    throw new Error(
      "GCP project ID is required. Set GCP_PROJECT_ID or GOOGLE_CLOUD_PROJECT."
    );
  }

  const feeds = (process.env.RSS_FEEDS || "")
    .split(",")
    .map((feed) => feed.trim())
    .filter(Boolean);

  if (feeds.length === 0) {
    console.warn(
      "[summarizer] RSS_FEEDS is empty. The job will exit without processing."
    );
  }

  const maxItems = parsePositiveInt(process.env.MAX_ITEMS, 5);
  const concurrency = parsePositiveInt(process.env.CONCURRENCY, 1);
  const fetchTimeoutMs = parsePositiveInt(process.env.FETCH_TIMEOUT_MS, 15000);

  const openAiKey = process.env.OPENAI_API_KEY;
  if (!openAiKey) {
    throw new Error(
      "OPENAI_API_KEY must be provided (use Secret Manager for production)."
    );
  }
  const openAiModel = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const systemPrompt =
    process.env.OPENAI_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT;

  const deeplKey = process.env.DEEPL_API_KEY;
  if (!deeplKey) {
    throw new Error(
      "DEEPL_API_KEY must be provided (use Secret Manager for production)."
    );
  }
  const deeplTargetLang = normalizeTargetLang(process.env.DEEPL_TARGET_LANG);
  const deeplFormality = normalizeFormality(process.env.DEEPL_FORMALITY);

  return {
    projectId,
    feeds,
    maxItems,
    concurrency,
    fetchTimeoutMs,
    openAi: {
      apiKey: openAiKey,
      model: openAiModel,
      systemPrompt,
    },
    deepl: {
      apiKey: deeplKey,
      targetLang: deeplTargetLang,
      formality: deeplFormality,
    },
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function normalizeTargetLang(value?: string): TargetLanguageCode {
  const fallback: TargetLanguageCode = "ja";
  if (!value) return fallback;
  const canonicalPairs: [string, TargetLanguageCode][] = [
    ["bg", "bg"],
    ["cs", "cs"],
    ["da", "da"],
    ["de", "de"],
    ["el", "el"],
    ["en", "en-US"],
    ["en-gb", "en-GB"],
    ["en-us", "en-US"],
    ["es", "es"],
    ["et", "et"],
    ["fi", "fi"],
    ["fr", "fr"],
    ["hu", "hu"],
    ["id", "id"],
    ["it", "it"],
    ["ja", "ja"],
    ["ko", "ko"],
    ["lt", "lt"],
    ["lv", "lv"],
    ["nb", "nb"],
    ["nl", "nl"],
    ["pl", "pl"],
    ["pt", "pt-BR"],
    ["pt-br", "pt-BR"],
    ["pt-pt", "pt-PT"],
    ["ro", "ro"],
    ["ru", "ru"],
    ["sk", "sk"],
    ["sl", "sl"],
    ["sv", "sv"],
    ["tr", "tr"],
    ["uk", "uk"],
    ["zh", "zh"],
    ["zh-hans", "zh-HANS"],
    ["zh-hant", "zh-HANT"],
  ];
  const lookup = new Map<string, TargetLanguageCode>(canonicalPairs);
  const normalized = value.trim().toLowerCase();
  return lookup.get(normalized) ?? fallback;
}

function normalizeFormality(value?: string): Formality | undefined {
  if (!value) return undefined;
  const lower = value.toLowerCase();
  const allowed: Record<string, Formality> = {
    more: "more",
    less: "less",
    prefer_more: "prefer_more",
    prefer_less: "prefer_less",
    formal: "more",
    informal: "less",
  };
  return allowed[lower];
}
