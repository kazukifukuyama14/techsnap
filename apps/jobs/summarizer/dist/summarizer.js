"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateSummary = generateSummary;
const node_perf_hooks_1 = require("node:perf_hooks");
const OPENAI_INPUT_TEMPLATE = `You will receive the content of a technical article. Produce a concise bullet-like summary in English (max 3 bullet points) focusing on what engineers should learn.

Article content:
`;
async function generateSummary(deps, articleBody) {
    const start = node_perf_hooks_1.performance.now();
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
    const translation = await deps.translator.translateText(summaryEn, null, deps.targetLang, {
        formality: deps.formality,
    });
    const duration = Math.round(node_perf_hooks_1.performance.now() - start);
    const tokensUsed = completion.usage?.total_tokens;
    const promptTokens = completion.usage?.prompt_tokens;
    const completionTokens = completion.usage?.completion_tokens;
    const costUsd = estimateCostUsd(deps.model, promptTokens ?? undefined, completionTokens ?? undefined);
    return {
        summaryEn,
        summaryJa: translation.text,
        tokensUsed,
        costUsd,
        durationMs: duration,
    };
}
// Rough cost estimation. Values should be aligned with current pricing.
function estimateCostUsd(model, promptTokens, completionTokens) {
    if (!promptTokens && !completionTokens)
        return undefined;
    const pricing = getModelPricing(model);
    if (!pricing)
        return undefined;
    const promptCost = ((promptTokens || 0) / 1_000_000) * pricing.prompt;
    const completionCost = ((completionTokens || 0) / 1_000_000) * pricing.completion;
    const total = promptCost + completionCost;
    return Math.round(total * 10000) / 10000; // 4 decimal places
}
function getModelPricing(model) {
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
