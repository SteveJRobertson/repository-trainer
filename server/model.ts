import Anthropic from '@anthropic-ai/sdk';
import {betaZodOutputFormat} from '@anthropic-ai/sdk/helpers/beta/zod';
import type {z} from 'zod';

export type Turn = {role: 'user' | 'assistant'; content: string};

// The one thing the pipeline needs from a model: given a system prompt and a
// conversation, return output that matches a schema. Tests pass a stub.
export type AskModel = <T extends z.ZodType>(request: {
  schema: T;
  system: string;
  turns: Turn[];
  effort: 'medium' | 'high';
}) => Promise<z.infer<T>>;

export class ModelError extends Error {}

export const MODEL = process.env.TRAINER_MODEL ?? 'claude-opus-5-5';

export function createClaude(): AskModel {
  const client = new Anthropic();
  return async ({schema, system, turns, effort}) => {
    try {
      // Streamed because lessons are long; finalMessage() gives the parsed result.
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 64000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system,
        messages: turns,
        output_config: {effort, format: betaZodOutputFormat(schema)},
      });
      const message = await stream.finalMessage();
      if (message.stop_reason === 'refusal') {
        throw new ModelError('The model declined to process this repository.');
      }

      if (message.stop_reason === 'max_tokens') {
        throw new ModelError('The model ran out of room before finishing. Try a narrower feature.');
      }

      if (!message.parsed_output) {
        throw new ModelError('The model returned output that did not match the lesson format.');
      }

      return message.parsed_output as z.infer<typeof schema>;
    } catch (error) {
      if (error instanceof ModelError) {
        throw error;
      }

      if (error instanceof Anthropic.AuthenticationError) {
        throw new ModelError('No valid Anthropic API key. Set ANTHROPIC_API_KEY in .env.local and restart.');
      }

      if (error instanceof Anthropic.RateLimitError) {
        throw new ModelError('Anthropic rate limit reached. Wait a minute and try again.');
      }

      if (error instanceof Anthropic.APIError) {
        throw new ModelError(`Anthropic API error ${error.status ?? ''}: ${error.message}`);
      }

      // Missing credentials surface as a plain Error from the SDK.
      throw new ModelError(error instanceof Error ? error.message : String(error));
    }
  };
}
