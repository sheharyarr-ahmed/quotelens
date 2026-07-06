// Schema mirror test (SPEC.md - Quote schema and integrity): converts the
// hand-written Zod mirror via Zod 4's native z.toJSONSchema() and asserts
// field names, required sets, and enums match schema/quote.schema.json.
// Byte-identical comparison is the backend artifact test's job; this side
// is structural on purpose so client-only refinements stay possible.

import { z } from 'zod';

import { quoteSchema } from '../src/lib/quote-schema';

import artifact from '../../schema/quote.schema.json';

type JsonSchema = {
  properties?: Record<string, unknown>;
  required?: string[];
  $defs?: Record<string, JsonSchema>;
};

const mirror = z.toJSONSchema(quoteSchema, { io: 'input' }) as JsonSchema;

function lineItemSchema(schema: JsonSchema): JsonSchema {
  const items = (schema.properties?.line_items as { items: unknown }).items as {
    $ref?: string;
  };
  if (items.$ref) {
    const name = items.$ref.split('/').pop() as string;
    return (schema.$defs as Record<string, JsonSchema>)[name];
  }
  return items as JsonSchema;
}

function enumValues(property: unknown): string[] {
  return [...((property as { enum: string[] }).enum)].sort();
}

describe('Zod mirror matches the committed quote schema artifact', () => {
  test('quote property names match', () => {
    expect(Object.keys(mirror.properties ?? {}).sort()).toEqual(
      Object.keys(artifact.properties).sort(),
    );
  });

  test('quote required set matches', () => {
    expect([...(mirror.required ?? [])].sort()).toEqual(
      [...artifact.required].sort(),
    );
  });

  test('line item property names match', () => {
    const artifactItem = artifact.$defs.QuoteLineItem;
    const mirrorItem = lineItemSchema(mirror);
    expect(Object.keys(mirrorItem.properties ?? {}).sort()).toEqual(
      Object.keys(artifactItem.properties).sort(),
    );
  });

  test('line item required set matches', () => {
    const artifactItem = artifact.$defs.QuoteLineItem;
    const mirrorItem = lineItemSchema(mirror);
    expect([...(mirrorItem.required ?? [])].sort()).toEqual(
      [...artifactItem.required].sort(),
    );
  });

  test('photo_citations stays mandatorily non-empty', () => {
    const mirrorItem = lineItemSchema(mirror);
    const citations = mirrorItem.properties?.photo_citations as {
      minItems?: number;
    };
    expect(citations.minItems).toBe(1);
    expect(artifact.$defs.QuoteLineItem.properties.photo_citations.minItems).toBe(1);
  });

  test('enums match: unit, confidence, status', () => {
    const artifactItem = artifact.$defs.QuoteLineItem;
    const mirrorItem = lineItemSchema(mirror);
    expect(enumValues(mirrorItem.properties?.unit)).toEqual(
      enumValues(artifactItem.properties.unit),
    );
    expect(enumValues(mirrorItem.properties?.confidence)).toEqual(
      enumValues(artifactItem.properties.confidence),
    );
    expect(enumValues(mirror.properties?.status)).toEqual(
      enumValues(artifact.properties.status),
    );
  });
});
