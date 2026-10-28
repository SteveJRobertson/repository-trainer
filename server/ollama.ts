import {Ollama} from 'ollama';
import {jsonSchema, parseReply} from './jsonSchema';
import {ModelError, type AskModel} from './model';

// Local models: no key, nothing leaves the machine. Lessons send up to about
// 70k tokens, and Ollama silently drops input beyond the context window, so
// the default window is large. Lower OLLAMA_NUM_CTX if the model can't fit it.
export function createOllama(): AskModel {
  const host = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
  const client = new Ollama({host});
  const model = process.env.OLLAMA_MODEL ?? '';
  const numCtx = Number(process.env.OLLAMA_NUM_CTX) || 131072;
  return async ({schema, system, turns}) => {
    try {
      // Streamed so a slow local model doesn't hit request timeouts.
      const stream = await client.chat({
        model,
        messages: [{role: 'system', content: system}, ...turns],
        stream: true,
        format: jsonSchema(schema),
        options: {num_ctx: numCtx},
      });
      let text = '';
      let doneReason = '';
      for await (const part of stream) {
        text += part.message.content;
        doneReason = part.done_reason ?? doneReason;
      }

      if (doneReason === 'length') {
        throw new ModelError('The model ran out of room before finishing. Try a narrower feature, or raise OLLAMA_NUM_CTX.');
      }

      const parsed = parseReply(schema, text);
      if (parsed === undefined) {
        throw new ModelError(`${model} returned output that did not match the lesson format. Smaller local models often struggle with this; try a larger one.`);
      }

      return parsed;
    } catch (error) {
      if (error instanceof ModelError) {
        throw error;
      }

      const status = (error as {status_code?: number}).status_code;
      if (status === 404) {
        throw new ModelError(`Ollama doesn't have ${model}. Run "ollama pull ${model}" and try again.`);
      }

      if (status !== undefined) {
        throw new ModelError(`Ollama error ${status}: ${(error as Error).message}`);
      }

      // fetch reports a refused connection or bad host as a TypeError.
      if (error instanceof TypeError) {
        throw new ModelError(`Can't reach Ollama at ${host}. Start it with "ollama serve", or set OLLAMA_HOST.`);
      }

      throw new ModelError(error instanceof Error ? error.message : String(error));
    }
  };
}
