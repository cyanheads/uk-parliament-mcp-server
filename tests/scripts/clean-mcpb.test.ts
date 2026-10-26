/**
 * @fileoverview Bundle pruning preserves runtime skills modules while removing agent documentation.
 * @module tests/scripts/clean-mcpb.test
 */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { AGENT_DOC_ENTRY, filterAgentDocEntries } from '../../scripts/clean-mcpb.js';

it('keeps SDK runtime skills modules and strips package-level agent trees', () => {
  const docs = [
    'node_modules/example/skills/research/SKILL.md',
    'node_modules/@example/package/skills/research/reference.md',
    'node_modules/parent/node_modules/@example/package/skills/research/reference.md',
    'node_modules/example/framework-skills/research/SKILL.md',
    'node_modules/example/.claude/settings.json',
    'node_modules/example/.agents/config.json',
    'node_modules/example/nested/SKILL.md',
  ];
  const runtime = [
    'node_modules/@modelcontextprotocol/server/dist/ext/skills/index.mjs',
    'node_modules/@modelcontextprotocol/server/dist/ext/skills/node.mjs',
    'node_modules/@modelcontextprotocol/core/dist/ext/skills/index.mjs',
    'node_modules/parent/node_modules/@modelcontextprotocol/core/dist/ext/skills/index.mjs',
    'skills/research/SKILL.md',
  ];
  expect(filterAgentDocEntries([...docs, ...runtime])).toEqual(docs);
  const lint = readFileSync(new URL('../../scripts/lint-packaging.ts', import.meta.url), 'utf8');
  expect(lint).toContain(AGENT_DOC_ENTRY.toString());
});
