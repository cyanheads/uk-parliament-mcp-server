/**
 * @fileoverview Independent decoder rejects malformed text and preserves nested JSON and enrichment.
 * @module tests/tools/rendered-payload.test
 */
import { expect, it } from 'vitest';
import { renderedPayload } from './rendered-payload.js';

it('decodes nested values and enrichment without treating source links as data', () => {
  const rendered =
    'value\n````json\n{"items":[{"text":"```\\n🦊","empty":null}]}\n````\n[Open source link](<https://example.org>)\n\napplied\n```json\n{"limit":2}\n```';
  expect(renderedPayload(rendered)).toEqual({
    items: [{ text: '```\n🦊', empty: null }],
    applied: { limit: 2 },
  });
  expect(renderedPayload(rendered)).not.toMatchObject({ applied: { limit: 3 } });
  expect(() => renderedPayload('no payload')).toThrow('No JSON blocks');
  expect(() => renderedPayload('value\n```json\n{}\n````')).toThrow('Unclosed');
});
