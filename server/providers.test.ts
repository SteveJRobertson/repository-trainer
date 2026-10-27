import {afterEach, describe, expect, it, vi} from 'vitest';
import {z} from 'zod';
import {createApp} from './app';
import {jsonSchema, parseReply, strictSchema} from './jsonSchema';
import {createProvider, listProviders} from './providers';
import {DraftLesson} from './schemas';

type Node = {[key: string]: unknown};

function visit(node: unknown, check: (node: Node) => void) {
  if (Array.isArray(node)) {
    node.forEach(child => visit(child, check));
  } else if (typeof node === 'object' && node !== null) {
    check(node as Node);
    Object.values(node).forEach(child => visit(child, check));
  }
}

describe('JSON schemas for other providers', () => {
  it('meets OpenAI strict mode: every property required, no extras, optional fields nullable', () => {
    const schema = strictSchema(DraftLesson);
    visit(schema, node => {
      expect(node).not.toHaveProperty('oneOf');
      expect(node).not.toHaveProperty('const');
      expect(node).not.toHaveProperty('$schema');
      if (node.type === 'object') {
        expect(node.additionalProperties).toBe(false);
        expect(node.required).toEqual(Object.keys(node.properties as Node));
      }
    });
    const step = ((schema.properties as Node).steps as Node).items as Node;
    expect((step.properties as Node).code).toMatchObject({anyOf: [{type: 'array'}, {type: 'null'}]});
    expect((step.properties as Node).id).toEqual({type: 'string'});
  });

  it('keeps optional fields optional for Gemini', () => {
    const schema = jsonSchema(z.object({a: z.string(), b: z.number().int().optional()}));
    expect(schema).toEqual({type: 'object', properties: {a: {type: 'string'}, b: {type: 'integer'}}, required: ['a'], additionalProperties: false});
  });

  it('drops nulls before checking the reply against the zod schema', () => {
    const reply = {title: 't', feature: 'f', estimatedMinutes: 5, diagram: {nodes: [], edges: [{from: 'a', to: 'b', label: null, evidence: 'verified'}]}, steps: [{id: 's', title: 'S', explanation: 'e', code: null, activity: null, claims: null}]};
    expect(parseReply(DraftLesson, JSON.stringify(reply))?.steps[0]).toEqual({id: 's', title: 'S', explanation: 'e'});
    expect(parseReply(DraftLesson, '{"title": 1}')).toBeUndefined();
    expect(parseReply(DraftLesson, 'not json')).toBeUndefined();
  });
});

describe('providers', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('reports which providers have a key and refuses ones that do not', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    vi.stubEnv('GEMINI_API_KEY', '');
    expect(listProviders().map(p => [p.id, p.available])).toEqual([['claude', false], ['chatgpt', true], ['gemini', false]]);
    expect(() => createProvider('gemini')).toThrow(/GEMINI_API_KEY/);

    const app = createApp();
    expect(await (await app.request('/api/providers')).json()).toHaveLength(3);
    const post = (provider: unknown) => app.request('/api/suggestions', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({repo: 'o/r', provider})});
    const missing = await post('claude');
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as {error: string}).error).toMatch(/ANTHROPIC_API_KEY/);
    expect((await post('llama')).status).toBe(400);
  });
});
