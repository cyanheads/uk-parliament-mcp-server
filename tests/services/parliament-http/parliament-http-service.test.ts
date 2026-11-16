/**
 * @fileoverview Transport resilience tested at injected network and clock boundaries.
 * @module tests/services/parliament-http/parliament-http-service.test
 */
import { z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError, timeout } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { logger } from '@cyanheads/mcp-ts-core/utils';
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
/** An upstream that answers after `delayMs` of fake time unless the request is aborted first. */
function answersAfter(delayMs: number, response: () => Response): ParliamentExchange {
  return (_url, _timeoutMs, _ctx, signal) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(response()), delayMs);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(signal.reason);
        },
        { once: true },
      );
    });
}
/** Tracks settlement so a test can show a call is still pending one millisecond before it ends. */
function track<T>(promise: Promise<T>) {
  const state = { settled: false };
  promise.then(
    () => {
      state.settled = true;
    },
    () => {
      state.settled = true;
    },
  );
  return state;
}
/** Log records whose context names the fetch layer's classification. */
function fetchRecords(spy: { mock: { calls: unknown[][] } }): unknown[] {
  return spy.mock.calls
    .map(
      (args) => (args[1] as { extra?: { errorSource?: unknown } } | undefined)?.extra?.errorSource,
    )
    .filter((source) => source !== undefined);
}

describe('Parliament HTTP boundary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
  });
  afterEach(() => {
    for (const current of services.splice(0)) current.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
    expect(exchange.mock.calls.map((args) => args[3].reason)).toEqual([reason, reason]);
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

  it('reads a stalled body on one attempt until the call deadline, then cancels the stream', async () => {
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
    const pending = http.get(call, 'bills', '/one', schema);
    const state = track(pending);
    const assertion = expect(pending).rejects.toMatchObject({
      code: JsonRpcErrorCode.Timeout,
      data: { reason: 'call_deadline_exceeded' },
    });
    await vi.advanceTimersByTimeAsync(44_999);
    expect(state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(exchange.mock.calls.map((args) => args[1])).toEqual([45_000]);
  });

  it('gives a stalled exchange one attempt bounded by the whole call budget', async () => {
    const exchange = vi
      .fn<ParliamentExchange>()
      .mockImplementation((_url, _timeoutMs, _ctx, signal) => abortedResponse(signal));
    const http = service(exchange);
    using call = http.beginCall(createMockContext());
    const pending = http.get(call, 'questions', '/one', schema);
    const state = track(pending);
    const assertion = expect(pending).rejects.toMatchObject({
      code: JsonRpcErrorCode.Timeout,
      message: 'Parliament call exceeded its 45000 ms deadline.',
      data: { reason: 'call_deadline_exceeded' },
    });
    await vi.advanceTimersByTimeAsync(44_999);
    expect(state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(exchange.mock.calls[0]?.[1]).toBe(45_000);
    // The exchange sees a deadline, not a caller abort.
    expect(exchange.mock.calls[0]?.[3].reason).toMatchObject({
      name: 'TimeoutError',
      message: 'Parliament call exceeded its 45000 ms deadline.',
    });
  });

  it('resolves a slow answer on its single attempt', async () => {
    const exchange = vi.fn(answersAfter(30_000, () => Response.json({ id: '42' })));
    const http = service(exchange);
    using call = http.beginCall(createMockContext());
    const pending = http.get(call, 'questions', '/one', schema);
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(pending).resolves.toMatchObject({ data: { id: '42' } });
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(exchange.mock.calls[0]?.[1]).toBe(45_000);
  });

  it('surfaces a slow HTTP 500 at once instead of repeating it into the deadline', async () => {
    const exchange = vi.fn(answersAfter(31_000, () => new Response('', { status: 500 })));
    const http = service(exchange);
    using call = http.beginCall(createMockContext());
    const pending = http.get(call, 'questions', '/one', schema);
    const state = track(pending);
    const assertion = expect(pending).rejects.toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
      data: { status: 500, reason: 'http_server_error' },
    });
    await vi.advanceTimersByTimeAsync(30_999);
    expect(state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(exchange).toHaveBeenCalledTimes(1);
  });

  it('retries fast 503s twice inside the remaining budget and keeps the reason through exhaustion', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const exchange = vi
      .fn<ParliamentExchange>()
      .mockImplementation(async () => new Response('', { status: 503 }));
    const http = service(exchange);
    using call = http.beginCall(createMockContext());
    const pending = http.get(call, 'bills', '/one', schema);
    const assertion = expect(pending).rejects.toBeInstanceOf(McpError);
    await vi.runAllTimersAsync();
    await assertion;
    const error = (await pending.catch((caught: unknown) => caught)) as McpError;
    expect(error.code).toBe(JsonRpcErrorCode.ServiceUnavailable);
    expect(error.message).toBe('UK Parliament returned HTTP 503. (failed after 3 attempts)');
    expect(error.data).toMatchObject({
      status: 503,
      reason: 'http_server_error',
      retryAttempts: 3,
      operation: 'parliament.bills',
    });
    expect(error.data).not.toHaveProperty('retryable');
    // Backoff 1,000 ms then 2,000 ms at the jitter midpoint; each attempt gets what is left.
    expect(exchange.mock.calls.map((args) => args[1])).toEqual([45_000, 44_000, 42_000]);
  });

  it.each([
    { failedAtMs: 21_875, calls: 2, settledAtMs: 44_750 },
    { failedAtMs: 21_876, calls: 1, settledAtMs: 21_876 },
  ])(
    'retries a 503 after $failedAtMs ms only while the budget after backoff covers another such attempt',
    async ({ failedAtMs, calls, settledAtMs }) => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const exchange = vi.fn(answersAfter(failedAtMs, () => new Response('', { status: 503 })));
      const http = service(exchange);
      using call = http.beginCall(createMockContext());
      const pending = http.get(call, 'committees', '/one', schema);
      const state = track(pending);
      const assertion = expect(pending).rejects.toMatchObject({
        code: JsonRpcErrorCode.ServiceUnavailable,
        data: { status: 503, reason: 'http_server_error' },
      });
      await vi.advanceTimersByTimeAsync(settledAtMs - 1);
      expect(state.settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await assertion;
      expect(exchange).toHaveBeenCalledTimes(calls);
      expect(exchange.mock.calls[0]?.[1]).toBe(45_000);
      if (calls === 2) expect(exchange.mock.calls[1]?.[1]).toBe(45_000 - failedAtMs - 1000);
    },
  );

  it.each([
    { status: 500, calls: 3 },
    { status: 501, calls: 1 },
    { status: 502, calls: 3 },
    { status: 503, calls: 3 },
    { status: 504, calls: 3 },
    { status: 505, calls: 1 },
  ])(
    'maps HTTP $status to http_server_error after $calls attempt(s)',
    async ({ status, calls }) => {
      const exchange = vi
        .fn<ParliamentExchange>()
        .mockImplementation(async () => new Response('', { status }));
      const http = service(exchange);
      using call = http.beginCall(createMockContext());
      const assertion = expect(http.get(call, 'bills', '/one', schema)).rejects.toMatchObject({
        code: JsonRpcErrorCode.ServiceUnavailable,
        data: { status, reason: 'http_server_error' },
      });
      await vi.runAllTimersAsync();
      await assertion;
      expect(exchange).toHaveBeenCalledTimes(calls);
    },
  );

  it('reports a 429 whose Retry-After outlasts the budget instead of sleeping into the deadline', async () => {
    const exchange = vi.fn(
      answersAfter(
        40_000,
        () => new Response('', { status: 429, headers: { 'Retry-After': '8' } }),
      ),
    );
    const http = service(exchange);
    using call = http.beginCall(createMockContext());
    const pending = http.get(call, 'members', '/one', schema);
    const state = track(pending);
    const assertion = expect(pending).rejects.toMatchObject({
      code: JsonRpcErrorCode.RateLimited,
      data: { status: 429, reason: 'http_rate_limited', retryAfter: '8' },
    });
    await vi.advanceTimersByTimeAsync(39_999);
    expect(state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(exchange).toHaveBeenCalledTimes(1);
  });

  it('surfaces a fast late 429 at once when its Retry-After cooldown outlasts the remaining budget', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const exchange = vi
      .fn<ParliamentExchange>()
      .mockImplementation(
        async () => new Response('', { status: 429, headers: { 'Retry-After': '8' } }),
      );
    const http = service(exchange);
    using call = http.beginCall(createMockContext());
    // 7,000 ms remain: more than a backoff, less than the 8,000 ms the origin asked to wait.
    await vi.advanceTimersByTimeAsync(38_000);
    const pending = http.get(call, 'members', '/one', schema);
    const state = track(pending);
    const assertion = expect(pending).rejects.toMatchObject({
      code: JsonRpcErrorCode.RateLimited,
      data: { status: 429, reason: 'http_rate_limited', retryAfter: '8' },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(state.settled).toBe(true);
    await assertion;
    expect(exchange).toHaveBeenCalledTimes(1);
  });

  it('treats the exchange timing out on the remaining budget as the call deadline', async () => {
    const exchange = vi
      .fn<ParliamentExchange>()
      .mockImplementation(
        (_url, timeoutMs) =>
          new Promise((_resolve, reject) =>
            setTimeout(
              () => reject(timeout('fetch GET timed out.', { errorSource: 'FetchTimeout' })),
              timeoutMs - 1,
            ),
          ),
      );
    const http = service(exchange);
    using call = http.beginCall(createMockContext());
    const assertion = expect(http.get(call, 'hansard', '/one', schema)).rejects.toMatchObject({
      code: JsonRpcErrorCode.Timeout,
      data: { reason: 'call_deadline_exceeded' },
    });
    await vi.runAllTimersAsync();
    await assertion;
    expect(exchange).toHaveBeenCalledTimes(1);
  });

  it('records the deadline as a timeout and a caller abort as cancellation at the real fetch boundary', async () => {
    vi.stubGlobal('fetch', (_input: unknown, init: RequestInit) => abortedResponse(init.signal!));
    const info = vi.spyOn(logger, 'info');
    const error = vi.spyOn(logger, 'error');
    const http = new ParliamentHttpService();
    services.push(http);
    {
      using call = http.beginCall(createMockContext());
      const assertion = expect(http.get(call, 'bills', '/one', schema)).rejects.toMatchObject({
        data: { reason: 'call_deadline_exceeded' },
      });
      await vi.advanceTimersByTimeAsync(45_000);
      await assertion;
    }
    expect(fetchRecords(error)).toEqual(['FetchSignalTimeout']);
    expect(fetchRecords(info)).toEqual([]);
    const controller = new AbortController();
    {
      using call = http.beginCall(createMockContext({ signal: controller.signal }));
      const pending = http.get(call, 'bills', '/one', schema);
      await vi.advanceTimersByTimeAsync(0);
      const reason = new DOMException('Caller left.', 'AbortError');
      controller.abort(reason);
      await expect(pending).rejects.toBe(reason);
    }
    expect(fetchRecords(info)).toEqual(['FetchAborted']);
    expect(fetchRecords(error)).toEqual(['FetchSignalTimeout']);
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
