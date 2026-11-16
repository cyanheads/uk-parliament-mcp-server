/**
 * @fileoverview Answering-body filter normalization and complete-reference validation shared by the Questions API tools.
 * @module services/parliament-http/answering-body-filter
 */
import { invalidParams } from '@cyanheads/mcp-ts-core/errors';
import { getMembers } from '../members/members-service.js';
import type { ParliamentCall } from './parliament-http-service.js';

/** Deduplicate and order IDs so equivalent selections echo and bind cursors identically. */
export function canonicalAnsweringBodyIds(ids: string[] | undefined): string[] | undefined {
  return ids === undefined ? undefined : [...new Set(ids)].sort((a, b) => Number(a) - Number(b));
}

/**
 * Read the complete Members answering-body reference within the caller's call before any search request.
 * Throws `unknown_reference_id` (InvalidParams) when the reference excludes a supplied ID.
 */
export async function assertKnownAnsweringBodies(
  call: ParliamentCall,
  ids: readonly string[],
): Promise<void> {
  const reference = await getMembers().answeringBodies(call);
  const known = new Set(reference.data.map((body) => String(body.id)));
  if (ids.some((id) => !known.has(id)))
    throw invalidParams('An answering-body ID is absent from the complete official reference.', {
      reason: 'unknown_reference_id',
    });
}
