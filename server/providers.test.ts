import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {z} from 'zod';
import {createApp} from './app';
import {jsonSchema, parseReply, strictSchema} from './jsonSchema';
import {createOllama} from './ollama';
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
    vi.stubEnv('OLLAMA_MODEL', '');
    expect(listProviders().map(p => [p.id, p.available])).toEqual([['claude', false], ['chatgpt', true], ['gemini', false], ['ollama', false]]);
    expect(() => createProvider('gemini')).toThrow(/GEMINI_API_KEY/);

    const app = createApp();
    expect(await (await app.request('/api/providers')).json()).toHaveLength(4);
    const post = (provider: unknown) => app.request('/api/suggestions', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({repo: 'o/r', provider})});
    const missing = await post('claude');
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as {error: string}).error).toMatch(/ANTHROPIC_API_KEY/);
    expect((await post('llama')).status).toBe(400);
  });
});

describe('Ollama', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('streams a structured reply from a local server and explains common failures', async () => {
    const requests: {model: string; format: unknown; messages: {role: string}[]; options: {num_ctx: number}}[] = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        const request = JSON.parse(body);
        requests.push(request);
        if (request.model === 'missing') {
          res.writeHead(404, {'content-type': 'application/json'}).end(JSON.stringify({error: 'model "missing" not found'}));
          return;
        }

        res.writeHead(200, {'content-type': 'application/x-ndjson'});
        const reply = JSON.stringify({a: 'hi', b: null});
        for (const piece of [reply.slice(0, 5), reply.slice(5)]) {
          res.write(JSON.stringify({model: request.model, message: {role: 'assistant', content: piece}, done: false}) + '\n');
        }

        res.end(JSON.stringify({model: request.model, message: {role: 'assistant', content: ''}, done: true, done_reason: 'stop'}) + '\n');
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const schema = z.object({a: z.string(), b: z.number().optional()});
    const ask = {schema, system: 'sys', turns: [{role: 'user' as const, content: 'hi'}], effort: 'medium' as const};
    try {
      vi.stubEnv('OLLAMA_HOST', `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
      vi.stubEnv('OLLAMA_MODEL', 'qwen');
      expect(await createOllama()(ask)).toEqual({a: 'hi'});
      expect(requests[0]).toMatchObject({model: 'qwen', format: jsonSchema(schema), options: {num_ctx: 131072}});
      expect(requests[0].messages.map(message => message.role)).toEqual(['system', 'user']);

      vi.stubEnv('OLLAMA_MODEL', 'missing');
      await expect(createOllama()(ask)).rejects.toThrow('ollama pull missing');
    } finally {
      server.close();
    }

    vi.stubEnv('OLLAMA_HOST', 'http://127.0.0.1:1');
    await expect(createOllama()(ask)).rejects.toThrow(/Can't reach Ollama/);
  });
});
