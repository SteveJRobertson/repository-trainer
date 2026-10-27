import OpenAI from 'openai';
import {parseReply, strictSchema} from './jsonSchema';
import {ModelError, type AskModel} from './model';

export function createChatGpt(): AskModel {
  // OPENAI_BASE_URL is read by the SDK too, for proxies or compatible gateways.
  const client = new OpenAI();
  const model = process.env.OPENAI_MODEL ?? 'gpt-5.5';
  return async ({schema, system, turns, effort}) => {
    try {
      // Streamed so long lessons don't hit request timeouts.
      const stream = client.responses.stream({
        model,
        instructions: system,
        input: turns,
        max_output_tokens: 64000,
        reasoning: {effort},
        store: false,
        text: {format: {type: 'json_schema', name: 'output', strict: true, schema: strictSchema(schema)}},
      });
      const response = await stream.finalResponse();
      const refused = response.output.some(item => item.type === 'message' && item.content.some(part => part.type === 'refusal'));
      if (refused || response.incomplete_details?.reason === 'content_filter') {
        throw new ModelError('The model declined to process this repository.');
      }

      if (response.incomplete_details?.reason === 'max_output_tokens') {
        throw new ModelError('The model ran out of room before finishing. Try a narrower feature.');
      }

      const parsed = parseReply(schema, response.output_text);
      if (parsed === undefined) {
        throw new ModelError('The model returned output that did not match the lesson format.');
      }

      return parsed;
    } catch (error) {
      if (error instanceof ModelError) {
        throw error;
      }

      if (error instanceof OpenAI.AuthenticationError) {
        throw new ModelError('No valid OpenAI API key. Set OPENAI_API_KEY in .env.local and restart.');
      }

      if (error instanceof OpenAI.RateLimitError) {
        throw new ModelError('OpenAI rate limit or quota reached. Wait a minute, or check your billing, and try again.');
      }

      if (error instanceof OpenAI.APIError) {
        throw new ModelError(`OpenAI API error${error.status ? ` ${error.status}` : ''}: ${error.message}`);
      }

      throw new ModelError(error instanceof Error ? error.message : String(error));
    }
  };
}
