// Turns the zod schemas into JSON Schema that the OpenAI and Gemini APIs
// accept. Claude's SDK does this itself.
import {z} from 'zod';

type Json = {[key: string]: unknown};

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

// The common subset: no oneOf (both APIs want anyOf), no const (use a
// one-value enum), and no safe-integer bounds, which zod adds to every int.
function simplify(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(simplify);
  }

  if (!isObject(node)) {
    return node;
  }

  const out: Json = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === '$schema' || ((key === 'minimum' || key === 'maximum') && Math.abs(value as number) === Number.MAX_SAFE_INTEGER)) {
      continue;
    }

    if (key === 'const') {
      out.enum = [value];
    } else {
      out[key === 'oneOf' ? 'anyOf' : key] = simplify(value);
    }
  }

  return out;
}

export function jsonSchema(schema: z.ZodType): Json {
  return simplify(z.toJSONSchema(schema, {io: 'output'})) as Json;
}

const nullable = (node: Json): Json => (node.anyOf ? {anyOf: [...(node.anyOf as Json[]), {type: 'null'}]} : {anyOf: [node, {type: 'null'}]});

// OpenAI's strict mode needs every property listed as required and no extra
// properties. Optional fields become nullable instead; stripNulls undoes that
// before the result is checked against the zod schema.
export function strictSchema(schema: z.ZodType): Json {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map(walk);
    }

    if (!isObject(node)) {
      return node;
    }

    const out = Object.fromEntries(Object.entries(node).map(([key, value]) => [key, key === 'properties' ? value : walk(value)]));
    if (isObject(node.properties)) {
      const required = new Set((node.required as string[] | undefined) ?? []);
      out.properties = Object.fromEntries(Object.entries(node.properties).map(([key, value]) => {
        const child = walk(value) as Json;
        return [key, required.has(key) ? child : nullable(child)];
      }));
      out.required = Object.keys(node.properties);
      out.additionalProperties = false;
    }

    return out;
  };

  return walk(jsonSchema(schema)) as Json;
}

export function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripNulls);
  }

  if (!isObject(value)) {
    return value;
  }

  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== null).map(([key, child]) => [key, stripNulls(child)]));
}

// Parses a model's JSON reply against the schema it was asked to follow.
export function parseReply<T extends z.ZodType>(schema: T, text: string): z.infer<T> | undefined {
  try {
    const result = schema.safeParse(stripNulls(JSON.parse(text)));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}
