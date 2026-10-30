// Client-safe list of inexpensive models with their published prices (USD per 1M tokens,
// standard tier). Checked against https://developers.openai.com/api/docs/pricing on 2026-10-28.
// Prices change — they're only used to pre-fill the editable estimates in AI Settings.

export type ModelPrice = { id: string; label: string; input: number; cachedInput: number; output: number; note?: string };

export const OPENAI_MODELS: ModelPrice[] = [
  { id: "gpt-6-luna", label: "GPT-6 Luna", input: 0.1, cachedInput: 0.01, output: 0.5, note: "Newest efficient model — lowest output price" },
  { id: "gpt-5-nano", label: "GPT-5 nano", input: 0.05, cachedInput: 0.005, output: 0.4, note: "Cheapest; weaker at multi-step tool use" },
  { id: "gpt-5-mini", label: "GPT-5 mini", input: 0.25, cachedInput: 0.025, output: 2.0, note: "Proven default" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", input: 0.2, cachedInput: 0.02, output: 1.2 },
  { id: "gpt-5.4-nano", label: "GPT-5.4 nano", input: 0.2, cachedInput: 0.02, output: 1.25 },
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini", input: 0.75, cachedInput: 0.075, output: 4.5 },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini", input: 0.4, cachedInput: 0.1, output: 1.6, note: "No reasoning" },
];

export const findModelPrice = (id: string) => OPENAI_MODELS.find((m) => m.id === id);

/** Models that accept the `reasoning.effort` parameter (others reject it). */
export const supportsReasoning = (model: string) => /^(gpt-5|gpt-6|o\d)/.test(model);
