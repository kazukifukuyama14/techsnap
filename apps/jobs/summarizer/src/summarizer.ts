import OpenAI from "openai";
import {
  Translator,
  type Formality,
  type TargetLanguageCode,
} from "deepl-node";
import { performance } from "node:perf_hooks";
import { SummarizationResult } from "./types";

export interface SummarizerDeps {
  openai: OpenAI;
  translator: Translator;
  model: string;
  systemPrompt: string;
  targetLang: TargetLanguageCode;
  formality?: Formality;
}

const OPENAI_INPUT_TEMPLATE = `You will receive the content of a technical article. Produce a concise bullet-like summary in English (max 3 bullet points) focusing on what engineers should learn.

Article content:
`;

export async function generateSummary(
  deps: SummarizerDeps,
  articleBody: string
): Promise<SummarizationResult> {
  const start = performance.now();

  const completion = await deps.openai.chat.completions.create({
    model: deps.model,
    messages: [
      { role: "system", content: deps.systemPrompt },
      { role: "user", content: `${OPENAI_INPUT_TEMPLATE}${articleBody}` },
    ],
    temperature: 0.3,
    max_tokens: 400,
  });

  const summaryEn = completion.choices[0]?.message?.content?.trim() ?? "";
  if (!summaryEn) {
    throw new Error("OpenAI returned empty summary");
  }

  const translation = await deps.translator.translateText(
    summaryEn,
    null,
    deps.targetLang,
    {
      formality: deps.formality,
    }
  );

  const duration = Math.round(performance.now() - start);
  const tokensUsed = completion.usage?.total_tokens;
  const promptTokens = completion.usage?.prompt_tokens;
  const completionTokens = completion.usage?.completion_tokens;
  const costUsd = estimateCostUsd(
    deps.model,
    promptTokens ?? undefined,
    completionTokens ?? undefined
  );

  return {
    summaryEn,
    summaryJa: translation.text,
    tokensUsed,
    costUsd,
    durationMs: duration,
  };
}

// Rough cost estimation. Values should be aligned with current pricing.
function estimateCostUsd(
  model: string,
  promptTokens?: number,
  completionTokens?: number
): number | undefined {
  if (!promptTokens && !completionTokens) return undefined;

  const pricing = getModelPricing(model);
  if (!pricing) return undefined;

  const promptCost = ((promptTokens || 0) / 1_000_000) * pricing.prompt;
  const completionCost =
    ((completionTokens || 0) / 1_000_000) * pricing.completion;
  const total = promptCost + completionCost;
  return Math.round(total * 10000) / 10000; // 4 decimal places
}

function getModelPricing(
  model: string
): { prompt: number; completion: number } | undefined {
  const normalized = model.toLowerCase();
  if (normalized.includes("gpt-4o-mini")) {
    return { prompt: 0.15, completion: 0.6 }; // $ per 1M tokens (approx)
  }
  if (normalized.includes("gpt-4o")) {
    return { prompt: 2.5, completion: 10 }; // approximate
  }
  if (normalized.includes("gpt-4.1")) {
    return { prompt: 1.25, completion: 5 }; // approximate
  }
  return undefined;
}
