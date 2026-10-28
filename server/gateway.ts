import {createGateway, jsonSchema as aiJsonSchema, Output, streamText, type LanguageModel} from 'ai';
import {jsonSchema, parseReply} from './jsonSchema';
import {ModelError, type AskModel} from './model';

// Vercel AI Gateway: one key, many providers' models, named "provider/model".
// The model can be injected for tests.
export function createVercel(model?: LanguageModel): AskModel {
  const modelId = process.env.AI_GATEWAY_MODEL ?? 'openai/gpt-5.5';
  const resolved = model ?? createGateway({apiKey: process.env.AI_GATEWAY_API_KEY})(modelId);
  return async ({schema, system, turns, effort}) => {
    let streamError: unknown;
    try {
      // Streamed so long lessons don't hit request timeouts.
      const result = streamText({
        model: resolved,
        system,
        messages: turns,
        maxOutputTokens: 64000,
        output: Output.object({schema: aiJsonSchema(jsonSchema(schema))}),
        // Each provider reads only its own options, so both can be set.
        providerOptions: {openai: {reasoningEffort: effort}, anthropic: {effort}},
        onError: ({error}) => {
          streamError = error;
        },
      });
      const [text, finishReason] = await Promise.all([result.text, result.finishReason]);
      if (streamError) {
        throw streamError;
      }

      if (finishReason === 'content-filter') {
        throw new ModelError('The model declined to process this repository.');
      }

      if (finishReason === 'length') {
        throw new ModelError('The model ran out of room before finishing. Try a narrower feature.');
      }

      const parsed = parseReply(schema, text);
      if (parsed === undefined) {
        throw new ModelError('The model returned output that did not match the lesson format.');
      }

      return parsed;
    } catch (caught) {
      // Retried failures arrive wrapped; the last attempt's error says why.
      const thrown = streamError ?? caught;
      const error = (thrown as {lastError?: unknown}).lastError ?? thrown;
      if (error instanceof ModelError) {
        throw error;
      }

      const name = error instanceof Error ? error.name : '';
      if (name === 'GatewayAuthenticationError') {
        throw new ModelError('No valid Vercel AI Gateway key. Set AI_GATEWAY_API_KEY in .env.local and restart.');
      }

      if (name === 'GatewayModelNotFoundError') {
        throw new ModelError(`The AI Gateway has no model called ${modelId}. Check AI_GATEWAY_MODEL against vercel.com/ai-gateway/models.`);
      }

      if (name === 'GatewayRateLimitError') {
        throw new ModelError('AI Gateway rate limit or credit limit reached. Wait a minute, or check your Vercel billing, and try again.');
      }

      throw new ModelError(error instanceof Error ? `AI Gateway error: ${error.message}` : String(error));
    }
  };
}
