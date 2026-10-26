/**
 * @fileoverview Decode public JSON blocks independently of the production formatter.
 * @module tests/tools/rendered-payload
 */

/** Reconstruct the payload and named enrichment blocks from text shown to MCP clients. */
export function renderedPayload(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null);
  const lines = text.split('\n');
  let blocks = 0;
  for (let index = 1; index < lines.length; index++) {
    const fence = /^(`{3,})json$/.exec(lines[index]!);
    if (!fence) continue;
    if (lines[index + 2] !== fence[1]) throw new Error('Unclosed JSON block.');
    const value: unknown = JSON.parse(lines[index + 1]!);
    const label = lines[index - 1]!;
    if (label === 'value') {
      if (value === null || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Expected an object payload.');
      Object.assign(result, value);
    } else result[label] = value;
    blocks++;
    index += 2;
  }
  if (!blocks) throw new Error('No JSON blocks were rendered.');
  return result;
}
