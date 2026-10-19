import type { ZodType } from 'zod';
import { config } from '../config.js';

export const isLlmEnabled = () => config.aiProvider !== 'local' && Boolean(config.openAiApiKey);

// Asks an OpenAI-compatible provider for a JSON answer. Any failure (network, timeout, invalid JSON
// or a shape that does not match the schema) returns null so callers fall back to local rules.
export const requestJson = async <T>(systemPrompt: string, payload: unknown, schema: ZodType<T>): Promise<T | null> => {
  if (!isLlmEnabled()) return null;
  try {
    const response = await fetch(`${config.openAiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.openAiApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.openAiModel,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(payload) },
        ],
      }),
      signal: AbortSignal.timeout(config.aiTimeoutMs),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = schema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};
