/**
 * @fileoverview Written-statement adapter tests at the Parliament exchange boundary.
 * @module tests/services/statements/statements-service.test
 */
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { disposeMembers } from '@/services/members/members-service.js';
import {
  disposeParliamentHttp,
  getParliamentHttp,
} from '@/services/parliament-http/parliament-http-service.js';
import { disposeStatements, getStatements } from '@/services/statements/statements-service.js';
import {
  answeringBodies,
  installStatements,
  item,
  page,
  statement,
} from './statements-fixtures.js';

afterEach(() => {
  disposeStatements();
  disposeMembers();
  disposeParliamentHttp();
  vi.useRealTimers();
});
describe('StatementsService', () => {
  it('sends only the fixed scope and paging when no filter is selected', async () => {
    const { requests } = installStatements(() => page([]));
    using call = getParliamentHttp().beginCall(createMockContext());
    await getStatements().search(call, {}, 0, 10);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.origin).toBe('https://questions-statements-api.parliament.uk');
    expect(requests[0]!.pathname).toBe('/api/writtenstatements/statements');
    expect(Object.fromEntries(requests[0]!.searchParams)).toEqual({
      sessionStatus: 'Any',
      expandMember: 'true',
      skip: '0',
      take: '10',
    });
  });
  it('reads the complete answering-body directory before the statements request within the same call', async () => {
    const { requests, signals } = installStatements((url) =>
      url.hostname.startsWith('members-') ? answeringBodies(35) : page([]),
    );
    using call = getParliamentHttp().beginCall(createMockContext());
    await getStatements().search(call, { answeringBodyIds: ['13', '35'] }, 0, 10);
    expect(requests.map((url) => url.pathname)).toEqual([
      '/api/Reference/AnsweringBodies',
      '/api/writtenstatements/statements',
    ]);
    expect(requests[1]!.searchParams.getAll('answeringBodies')).toEqual(['13', '35']);
    expect(signals.every((signal) => !signal.aborted)).toBe(true);
  });
  it('stops before the statements request when the caller cancels during the reference read', async () => {
    const controller = new AbortController();
    const { requests } = installStatements((url) => {
      if (!url.hostname.startsWith('members-')) return page([]);
      controller.abort();
      return answeringBodies(35);
    });
    using call = getParliamentHttp().beginCall(createMockContext({ signal: controller.signal }));
    // The caller's own abort propagates; it never becomes an unknown-ID or empty-reference verdict.
    await expect(
      getStatements().search(call, { answeringBodyIds: ['13'] }, 0, 10),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(requests.map((url) => url.pathname)).toEqual(['/api/Reference/AnsweringBodies']);
  });
  it('fails a stalled answering-body reference read on the call deadline, not as an unknown ID', async () => {
    vi.useFakeTimers();
    const { requests } = installStatements((url, signal) =>
      url.hostname.startsWith('members-')
        ? new Promise<Response>((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
          )
        : page([]),
    );
    using call = getParliamentHttp().beginCall(createMockContext());
    const pending = getStatements()
      .search(call, { answeringBodyIds: ['13'] }, 0, 10)
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(await pending).toMatchObject({
      code: JsonRpcErrorCode.Timeout,
      data: { reason: 'call_deadline_exceeded' },
    });
    expect(requests.map((url) => url.pathname)).toEqual(['/api/Reference/AnsweringBodies']);
  });
  it('rejects an answering-body ID absent from the reference without a statements request', async () => {
    const { requests } = installStatements((url) =>
      url.hostname.startsWith('members-') ? answeringBodies(35) : page([]),
    );
    using call = getParliamentHttp().beginCall(createMockContext());
    await expect(
      getStatements().search(call, { answeringBodyIds: ['13', '36'] }, 0, 10),
    ).rejects.toMatchObject({
      code: JsonRpcErrorCode.InvalidParams,
      data: { reason: 'unknown_reference_id' },
    });
    expect(requests.map((url) => url.pathname)).toEqual(['/api/Reference/AnsweringBodies']);
  });
  it('retrieves detail with expanded members across all sessions', async () => {
    const { requests } = installStatements(() => item());
    using call = getParliamentHttp().beginCall(createMockContext());
    const response = await getStatements().detail(call, '1952546');
    expect(response?.data.value).toMatchObject({ id: 1952546, uin: 'HLWS419' });
    expect(requests[0]!.pathname).toBe('/api/writtenstatements/statements/1952546');
    expect(Object.fromEntries(requests[0]!.searchParams)).toEqual({
      expandMember: 'true',
      sessionStatus: 'Any',
    });
  });
  it('maps an entity 404 to a miss and keeps a server failure explicit', async () => {
    installStatements(() => new Response('The resource 999999999 was not found', { status: 404 }));
    using missing = getParliamentHttp().beginCall(createMockContext());
    await expect(getStatements().detail(missing, '999999999')).resolves.toBeUndefined();
    disposeParliamentHttp();
    vi.useFakeTimers();
    installStatements(() => new Response(null, { status: 503 }));
    using failing = getParliamentHttp().beginCall(createMockContext());
    const pending = getStatements()
      .detail(failing, '1952546')
      .catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ code: JsonRpcErrorCode.ServiceUnavailable });
  });
  it('rejects a search response without its results collection instead of reporting no match', async () => {
    installStatements(() => ({ totalResults: 0 }));
    using call = getParliamentHttp().beginCall(createMockContext());
    await expect(getStatements().search(call, {}, 0, 10)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ValidationError,
    });
  });
  it('tolerates unmodeled source fields while validating the modeled ones', async () => {
    installStatements(() => page([{ ...statement(), futureField: 'kept out of output' }]));
    using call = getParliamentHttp().beginCall(createMockContext());
    const response = await getStatements().search(call, {}, 0, 10);
    expect(response.data.results[0]!.value).not.toHaveProperty('futureField');
    expect(response.data.results[0]!.value).not.toHaveProperty('hasAttachments');
    expect(response.data.results[0]).not.toHaveProperty('links');
  });
});
