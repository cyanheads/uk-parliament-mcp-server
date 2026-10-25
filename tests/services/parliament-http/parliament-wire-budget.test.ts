/**
 * @fileoverview Checks real framework enrichment composition after bounded delivery.
 * @module tests/services/parliament-http/parliament-wire-budget.test
 */
import { tool, z } from '@cyanheads/mcp-ts-core';
import { runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { expect, it } from 'vitest';
import {
  DeliveryShape,
  deliverPayload,
  enrichmentField,
  formatData,
} from '@/services/parliament-http/parliament-delivery.js';

it('keeps the framework-composed wire result within 24000 bytes near the delivery boundary', async () => {
  const applied = { limit: 20, source: 'official_reference_api', query: 'whole source selection' };
  const notice =
    'Contains Parliamentary information. Follow the returned cursor to read remaining complete records.';
  const boundaryTool = tool('parliament_budget_fixture', {
    description: 'Exercise Parliament delivery with real framework enrichment composition.',
    input: z.object({ size: z.number().int() }),
    output: z.object({ ...DeliveryShape, text: z.string().optional() }),
    enrichment: {
      applied: z.object({ limit: z.number(), source: z.string(), query: z.string() }),
      notice: z.string(),
      totalCount: z.number(),
      truncated: z.boolean(),
      shown: z.number(),
      cap: z.number(),
    },
    enrichmentTrailer: {
      applied: { render: enrichmentField('applied') },
      notice: { render: enrichmentField('notice') },
      totalCount: { render: enrichmentField('totalCount') },
      truncated: { render: enrichmentField('truncated') },
      shown: { render: enrichmentField('shown') },
      cap: { render: enrichmentField('cap') },
    },
    handler(input, ctx) {
      return deliverPayload(
        { text: 'x'.repeat(input.size) },
        {
          tool: 'parliament_budget_fixture',
          selection: { size: input.size },
          enrichmentFor: () => ({
            applied,
            notice,
            totalCount: 200,
            truncated: true,
            shown: 1,
            cap: 20,
          }),
          applyEnrichment: (values) => ctx.enrich(values),
        },
      );
    },
    format: formatData,
  });
  // Fixed independent sizes straddle the full/outline transition. Measure the actual
  // production-shaped result, including framework prefixes and final enrichment.
  for (let size = 11500; size <= 12000; size += 10) {
    const result = await runToolContract(boundaryTool, { size });
    expect(result.isError, `size=${size}`).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      applied,
      notice,
      totalCount: 200,
      truncated: true,
      shown: 1,
      cap: 20,
    });
    const text = result.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
    expect(text).toContain('200');
    expect(text).toContain(notice);
    expect(Buffer.byteLength(JSON.stringify(result)), `size=${size}`).toBeLessThanOrEqual(24000);
  }
});

it('measures collection enrichment from the actual emitted whole-item count', async () => {
  const items = Array.from({ length: 20 }, (_, id) => ({ id: String(id), text: 'x'.repeat(1800) }));
  const collectionTool = tool('parliament_collection_budget_fixture', {
    description: 'Exercise whole-item Parliament delivery with final collection enrichment.',
    input: z.object({}),
    output: z.object({
      ...DeliveryShape,
      items: z.array(z.object({ id: z.string(), text: z.string() })).optional(),
    }),
    enrichment: {
      shown: z.number(),
      truncated: z.boolean(),
      totalCount: z.number(),
      applied: z.object({ limit: z.number() }),
    },
    enrichmentTrailer: {
      shown: { render: enrichmentField('shown') },
      truncated: { render: enrichmentField('truncated') },
      totalCount: { render: enrichmentField('totalCount') },
      applied: { render: enrichmentField('applied') },
    },
    handler(_input, ctx) {
      return deliverPayload(
        { items },
        {
          tool: 'parliament_collection_budget_fixture',
          selection: { limit: 20 },
          collection: { count: 20, repage: (count) => ({ items: items.slice(0, count) }) },
          enrichmentFor: (selected) => ({
            shown: selected.items.length,
            truncated: selected.items.length < 20,
            totalCount: 20,
            applied: { limit: 20 },
          }),
          applyEnrichment: (values) => ctx.enrich(values),
        },
      );
    },
    format: formatData,
  });
  const result = await runToolContract(collectionTool, {});
  expect(result.isError).not.toBe(true);
  const schema = z.object({
    delivery: z.literal('full'),
    items: z.array(z.object({ id: z.string(), text: z.string() })),
    shown: z.number(),
    truncated: z.boolean(),
    totalCount: z.number(),
  });
  const output = schema.parse(result.structuredContent);
  expect(output.items.length).toBeGreaterThan(0);
  expect(output.items.length).toBeLessThan(20);
  expect(output.items).toEqual(items.slice(0, output.shown));
  expect(output.shown).toBe(output.items.length);
  expect(output.truncated).toBe(true);
  expect(output.totalCount).toBe(20);
  const text = result.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  expect(text).toContain(`shown\n\`\`\`json\n${output.items.length}\n\`\`\``);
  expect(text).toContain('truncated\n```json\ntrue\n```');
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(24000);
});
