/**
 * @fileoverview Transport resilience tested at injected network and clock boundaries.
 * @module tests/services/parliament-http/parliament-http-service.test
 */
import { z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ParliamentExchange,
  ParliamentHttpService,
} from '@/services/parliament-http/parliament-http-service.js';

const schema = z.object({ id: z.string(), count: z.number().nullable().optional() });
const services: ParliamentHttpService[] = [];
function service(exchange: ParliamentExchange): ParliamentHttpService {
  const result = new ParliamentHttpService({
    exchange,
    clock: {
      now: () => Date.now(),
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimeout,
    },
  });
  services.push(result);
  return result;
}
function abortedResponse(signal: AbortSignal): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal.throwIfAborted();
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

describe('Parliament HTTP boundary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
  });
  afterEach(() => {
    for (const current of services.splice(0)) current.dispose();
    vi.useRealTimers();
  });

  it('fixes origins and query allowlists before I/O', () => {
    const exchange = vi.fn<ParliamentExchange>();
    const http = service(exchange);
    expect(
      http.url(
        'members',
        '/api/Members/Search',
        { Name: 'A&B', House: 1, ids: ['3', '4'], absent: undefined },
        ['Name', 'House', 'ids'],
      ).href,
    ).toBe('https://members-api.parliament.uk/api/Members/Search?Name=A%26B&House=1&ids=3&ids=4');
    for (const path of [
      'https://evil.test',
      '//evil.test/a',
      '/a?redirect=x',
      '/a#fragment',
      '/\\evil.test',
    ])
      expect(() => http.url('bills', path)).toThrow();
    expect(() => http.url('bills', '/api/v1/Bills', { arbitrary: 'value' }, ['take'])).toThrow();
    expect(exchange).not.toHaveBeenCalled();
  });

  it('validates raw JSON once, preserving omitted/null values and dropping extra properties', async () => {
    const exchange = vi
      .fn<ParliamentExchange>()
      .mockResolvedValueOnce(Response.json({ id: '42', count: null, extra: 'not public' }))
      .mockResolvedValueOnce(Response.json({ id: '43' }));
    const http = service(exchange);
    using call = http.beginCall(createMockContext());
    expect((await http.get(call, 'bills', '/one', schema)).data).toEqual({ id: '42', count: null });
    const result = await http.get(call, 'bills', '/two', schema);
    expect(result.data).toEqual({ id: '43' });
    expect(result.source).toEqual({
      api: 'bills',
      url: 'https://bills-api.parliament.uk/two',
      retrievedAt: '2026-10-01T00:00:00.000Z',
      licenceUrl:
        'https://www.parliament.uk/site-information/copyright-parliament/open-parliament-licence/',
    });
  });

  it.each([
    { body: 'not json', status: 200, code: JsonRpcErrorCode.SerializationError },
    { body: '{}', status: 200, code: JsonRpcErrorCode.ValidationError },
    { body: '', status: 400, code: JsonRpcErrorCode.InvalidParams },
    { body: '', status: 403, code: JsonRpcErrorCode.Forbidden },
    { body: '', status: 404, code: JsonRpcErrorCode.NotFound },
    { body: '', status: 302, code: JsonRpcErrorCode.InvalidRequest },
  ])('does not retry status $status / code $code', async ({ body, status, code }) => {
    const exchange = vi
      .fn<ParliamentExchange>()
      .mockImplementation(async () => new Response(body, { status }));
    const http = service(exchange);
    using call = http.beginCall(createMockContext());
    await expect(http.get(call, 'bills', '/one', schema)).rejects.toMatchObject({ code });
    expect(exchange).toHaveBeenCalledTimes(1);
  });

  it.each(['network', 'html', '503'])(
    'retries transient %s failures through the full body boundary',
    async (failure) => {
      const exchange = vi
        .fn<ParliamentExchange>()
        .mockImplementationOnce(async () => {
          if (failure === 'network') throw new TypeError('socket closed');
          return new Response(failure === 'html' ? '<!doctype html><html>unavailable</html>' : '', {
            status: failure === '503' ? 503 : 200,
          });
        })
        .mockResolvedValueOnce(Response.json({ id: '42' }));
      const http = service(exchange);
      using call = http.beginCall(createMockContext());
      const pending = http.get(call, 'bills', '/one', schema);
      const assertion = expect(pending).resolves.toMatchObject({ data: { id: '42' } });
      await vi.runAllTimersAsync();
      await assertion;
      expect(exchange).toHaveBeenCalledTimes(2);
    },
  );

  it('caps retries at three network attempts', async () => {
    const exchange = vi.fn<ParliamentExchange>().mockRejectedValue(new TypeError('offline'));
    const http = service(exchange);
    using call = http.beginCall(createMockContext());
    const assertion = expect(http.get(call, 'bills', '/one', schema)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
    });
    await vi.runAllTimersAsync();
    await assertion;
    expect(exchange).toHaveBeenCalledTimes(3);
  });

  it('cancels active and queued requests without another attempt', async () => {
    const exchange = vi
      .fn<ParliamentExchange>()
      .mockImplementation((_url, _timeoutMs, _ctx, signal) => abortedResponse(signal));
    const http = service(exchange);
    const controller = new AbortController();
    using call = http.beginCall(createMockContext({ signal: controller.signal }));
    const pending = Array.from({ length: 3 }, () => http.get(call, 'bills', '/one', schema));
    const settled = Promise.allSettled(pending);
    await vi.advanceTimersByTimeAsync(0);
    expect(exchange).toHaveBeenCalledTimes(2);
    const reason = new DOMException('Caller cancelled selection.', 'AbortError');
    controller.abort(reason);
    expect(await settled).toEqual(
      Array.from({ length: 3 }, () => ({ status: 'rejected', reason })),
    );
    expect(exchange).toHaveBeenCalledTimes(2);
  });

  it('rejects the 33rd queued request and leaves two requests in flight', async () => {
    const exchange = vi
      .fn<ParliamentExchange>()
      .mockImplementation((_url, _timeoutMs, _ctx, signal) => abortedResponse(signal));
    const http = service(exchange);
    using call = http.beginCall(createMockContext());
    const pending = Array.from({ length: 34 }, () => http.get(call, 'bills', '/one', schema));
    const settled = Promise.allSettled(pending);
    await vi.advanceTimersByTimeAsync(0);
    await expect(http.get(call, 'bills', '/overflow', schema)).rejects.toMatchObject({
      code: JsonRpcErrorCode.RateLimited,
      data: { reason: 'queue_full' },
    });
    expect(exchange).toHaveBeenCalledTimes(2);
    http.dispose();
    expect((await settled).every((result) => result.status === 'rejected')).toBe(true);
  });

  it('shares a capped Retry-After cooldown with concurrent requests on the same origin', async () => {
    const exchange = vi
      .fn<ParliamentExchange>()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '100' } }))
      .mockImplementation(async () => Response.json({ id: '42' }));
    const http = service(exchange);
    using call = http.beginCall(createMockContext());
    const first = http.get(call, 'bills', '/one', schema);
    await vi.advanceTimersByTimeAsync(0);
    const second = http.get(call, 'bills', '/two', schema);
    await vi.advanceTimersByTimeAsync(7999);
    expect(exchange).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(exchange).toHaveBeenCalledTimes(3);
  });

  it('uses one deadline across consecutive requests rather than resetting the call clock', async () => {
    const exchange = vi
      .fn<ParliamentExchange>()
      .mockImplementation(async () => Response.json({ id: '42' }));
    const http = service(exchange);
    using call = http.beginCall(createMockContext());
    await vi.advanceTimersByTimeAsync(44000);
    await http.get(call, 'bills', '/one', schema);
    expect(exchange.mock.calls[0]?.[1]).toBe(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(http.get(call, 'members', '/two', schema)).rejects.toMatchObject({
      code: JsonRpcErrorCode.Timeout,
    });
    expect(exchange).toHaveBeenCalledTimes(1);
  });

  it('aborts a stalled response body on caller cancellation', async () => {
    const exchange = vi.fn<ParliamentExchange>().mockImplementation(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"id":'));
            },
          }),
        ),
    );
    const http = service(exchange);
    const controller = new AbortController();
    using call = http.beginCall(createMockContext({ signal: controller.signal }));
    let settled = false;
    const pending = http.get(call, 'bills', '/one', schema).finally(() => {
      settled = true;
    });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(new DOMException('Body cancelled.', 'AbortError'));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    await assertion;
    expect(exchange).toHaveBeenCalledTimes(1);
  });

  it('retries stalled body reads with the per-attempt timeout and cancels every stream', async () => {
    const cancel = vi.fn();
    const exchange = vi.fn<ParliamentExchange>().mockImplementation(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{'));
            },
            cancel,
          }),
        ),
    );
    const http = service(exchange);
    using call = http.beginCall(createMockContext());
    const assertion = expect(http.get(call, 'bills', '/one', schema)).rejects.toMatchObject({
      code: JsonRpcErrorCode.Timeout,
    });
    await vi.runAllTimersAsync();
    await assertion;
    expect(exchange).toHaveBeenCalledTimes(3);
    expect(cancel).toHaveBeenCalledTimes(3);
    expect(exchange.mock.calls.map((args) => args[1])).toEqual([12000, 12000, 12000]);
  });

  it('cancels retry backoff before another network operation starts', async () => {
    const exchange = vi.fn<ParliamentExchange>().mockRejectedValue(new TypeError('offline'));
    const http = service(exchange);
    const controller = new AbortController();
    using call = http.beginCall(createMockContext({ signal: controller.signal }));
    const assertion = expect(http.get(call, 'bills', '/one', schema)).rejects.toMatchObject({
      message: 'Cancel backoff.',
    });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(new DOMException('Cancel backoff.', 'AbortError'));
    await vi.runAllTimersAsync();
    await assertion;
    expect(exchange).toHaveBeenCalledTimes(1);
  });

  it('applies HTTP-date Retry-After to the same shared cooldown', async () => {
    const exchange = vi
      .fn<ParliamentExchange>()
      .mockResolvedValueOnce(
        new Response('', {
          status: 429,
          headers: { 'Retry-After': 'Thu, 01 Oct 2026 00:00:06 GMT' },
        }),
      )
      .mockImplementation(async () => Response.json({ id: '42' }));
    const http = service(exchange);
    using call = http.beginCall(createMockContext());
    const pending = http.get(call, 'members', '/one', schema);
    await vi.advanceTimersByTimeAsync(5999);
    expect(exchange).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ data: { id: '42' } });
    expect(exchange).toHaveBeenCalledTimes(2);
  });
});
