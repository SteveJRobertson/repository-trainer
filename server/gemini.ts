import {ApiError, FinishReason, GoogleGenAI, ThinkingLevel} from '@google/genai';
import {jsonSchema, parseReply} from './jsonSchema';
import {ModelError, type AskModel} from './model';

export function createGemini(): AskModel {
  const ai = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});
  const model = process.env.GEMINI_MODEL ?? 'gemini-3.6-flash';
  return async ({schema, system, turns, effort}) => {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: turns.map(turn => ({role: turn.role === 'assistant' ? 'model' : 'user', parts: [{text: turn.content}]})),
        config: {
          systemInstruction: system,
          maxOutputTokens: 65536,
          thinkingConfig: {thinkingLevel: effort === 'high' ? ThinkingLevel.HIGH : ThinkingLevel.MEDIUM},
          responseMimeType: 'application/json',
          responseJsonSchema: jsonSchema(schema),
        },
      });
      const finish = response.candidates?.[0]?.finishReason;
      if (response.promptFeedback?.blockReason || finish === FinishReason.SAFETY || finish === FinishReason.RECITATION) {
        throw new ModelError('The model declined to process this repository.');
      }

      if (finish === FinishReason.MAX_TOKENS) {
        throw new ModelError('The model ran out of room before finishing. Try a narrower feature.');
      }

      const parsed = parseReply(schema, response.text ?? '');
      if (parsed === undefined) {
        throw new ModelError('The model returned output that did not match the lesson format.');
      }

      return parsed;
    } catch (error) {
      if (error instanceof ModelError) {
        throw error;
      }

      if (error instanceof ApiError) {
        if (error.status === 400 && /api key/i.test(error.message) || error.status === 401 || error.status === 403) {
          throw new ModelError('No valid Gemini API key. Set GEMINI_API_KEY in .env.local and restart.');
        }

        if (error.status === 429) {
          throw new ModelError('Gemini rate limit or quota reached. Wait a minute and try again.');
        }

        throw new ModelError(`Gemini API error ${error.status}: ${error.message}`);
      }

      throw new ModelError(error instanceof Error ? error.message : String(error));
    }
  };
}
