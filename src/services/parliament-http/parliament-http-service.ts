/**
 * @fileoverview Fixed-origin Parliament GET transport with call-wide cancellation and bounded queues.
 * @module services/parliament-http/parliament-http-service
 */
import type { Context, z } from '@cyanheads/mcp-ts-core';
import {
  JsonRpcErrorCode,
  McpError,
  rateLimited,
  serializationError,
  serviceUnavailable,
  timeout,
  validationError,
} from '@cyanheads/mcp-ts-core/errors';
import { fetchWithTimeout, httpErrorFromResponse, withRetry } from '@cyanheads/mcp-ts-core/utils';
import { type Api, LICENCE_URL, type Source } from './parliament-models.js';

/** Verified origins; caller input can never select a host. */
export const PARLIAMENT_ORIGINS = {
  bills: 'https://bills-api.parliament.uk',
  members: 'https://members-api.parliament.uk',
  commons_votes: 'https://commonsvotes-api.parliament.uk',
  lords_votes: 'https://lordsvotes-api.parliament.uk',
  hansard: 'https://hansard-api.parliament.uk',
  questions: 'https://questions-statements-api.parliament.uk',
  committees: 'https://committees-api.parliament.uk',
} as const satisfies Record<Api, string>;

/** Injectable clock; fake timers can own all service deadlines and queue waits. */
export interface ParliamentClock {
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
  now(): number;
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
}
const systemClock: ParliamentClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (timer) => clearTimeout(timer),
};
/** Injected network boundary uses standard fetch semantics, without replacing global fetch. */
export type ParliamentExchange = (
  url: URL,
  timeoutMs: number,
  ctx: Context,
  signal: AbortSignal,
) => Promise<Response>;
/** One call handle is shared by every selected/nested source request. Dispose at the handler boundary. */
export interface ParliamentCall extends Disposable {
  readonly context: Context;
  readonly deadlineAt: number;
  readonly signal: AbortSignal;
}
interface Waiter {
  abort: () => void;
  reject: (error: unknown) => void;
  resolve: () => void;
  signal: AbortSignal;
}
interface OriginQueue {
  active: number;
  cooldownUntil: number;
  timer?: ReturnType<typeof setTimeout>;
  waiting: Waiter[];
}
/** Validated source response, retaining exact request provenance. */
export interface ParliamentResponse<T> {
  data: T;
  source: Source;
}
/** Only explicit verified query keys are accepted; arrays use repeated keys. */
export type ParliamentQuery = Readonly<
  Record<string, string | number | boolean | readonly (string | number)[] | undefined>
>;

/** Owns process-local per-origin queues; no persisted search or personal-data cache. */
export class ParliamentHttpService {
  private readonly clock: ParliamentClock;
  private readonly exchange: ParliamentExchange;
  private readonly queues = new Map<Api, OriginQueue>();
  private readonly calls = new Set<AbortController>();
  private disposed = false;

  constructor(options: { clock?: ParliamentClock; exchange?: ParliamentExchange } = {}) {
    this.clock = options.clock ?? systemClock;
    this.exchange =
      options.exchange ??
      ((url, timeoutMs, ctx, signal) =>
        fetchWithTimeout(url, timeoutMs, ctx, {
          method: 'GET',
          redirect: 'manual',
          signal,
          errorBodyLimit: 0,
          expectedStatuses: [404],
          headers: { Accept: 'application/json' },
        }));
  }

  /** Start once per tool call, before any parent check or selected collection fetch. */
  beginCall(context: Context): ParliamentCall {
    if (this.disposed) throw serviceUnavailable('Parliament transport has shut down.');
    const controller = new AbortController();
    const deadlineAt = this.clock.now() + 45_000;
    const timer = this.clock.setTimeout(
      () =>
        controller.abort(
          timeout('Parliament call exceeded its 45000 ms deadline.', {
            reason: 'call_deadline_exceeded',
          }),
        ),
      45_000,
    );
    const signal = AbortSignal.any([context.signal, controller.signal]);
    this.calls.add(controller);
    return {
      context,
      signal,
      deadlineAt,
      [Symbol.dispose]: () => {
        this.clock.clearTimeout(timer);
        this.calls.delete(controller);
        controller.abort();
      },
    };
  }

  private queue(api: Api): OriginQueue {
    let queue = this.queues.get(api);
    if (!queue) {
      queue = { active: 0, waiting: [], cooldownUntil: 0 };
      this.queues.set(api, queue);
    }
    return queue;
  }
  private dispatch(queue: OriginQueue): void {
    if (queue.timer !== undefined) {
      this.clock.clearTimeout(queue.timer);
      delete queue.timer;
    }
    const delayMs = queue.cooldownUntil - this.clock.now();
    if (delayMs > 0 && queue.waiting.length) {
      queue.timer = this.clock.setTimeout(() => {
        delete queue.timer;
        this.dispatch(queue);
      }, delayMs);
      return;
    }
    while (queue.active < 2 && queue.waiting.length) {
      const waiter = queue.waiting.shift();
      if (!waiter) break;
      waiter.signal.removeEventListener('abort', waiter.abort);
      if (waiter.signal.aborted) {
        waiter.reject(waiter.signal.reason);
        continue;
      }
      queue.active++;
      waiter.resolve();
    }
  }
  private async acquire(queue: OriginQueue, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (queue.active < 2 && !queue.waiting.length && queue.cooldownUntil <= this.clock.now()) {
      queue.active++;
      return;
    }
    if (queue.waiting.length >= 32)
      throw rateLimited('Parliament origin queue is full; repeat this tool later.', {
        reason: 'queue_full',
        retryable: false,
      });
    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        signal,
        abort: () => {
          const index = queue.waiting.indexOf(waiter);
          if (index >= 0) queue.waiting.splice(index, 1);
          reject(signal.reason);
          this.dispatch(queue);
        },
      };
      queue.waiting.push(waiter);
      signal.addEventListener('abort', waiter.abort, { once: true });
      this.dispatch(queue);
    });
  }
  private retryAfterMs(value: unknown): number {
    if (typeof value !== 'string') return 1000;
    const numeric = Number(value);
    return Math.max(
      0,
      Math.min(
        8000,
        Number.isFinite(numeric) ? numeric * 1000 : Date.parse(value) - this.clock.now() || 1000,
      ),
    );
  }
  private transient(error: unknown): boolean {
    if (!(error instanceof McpError) || error.data?.retryable === false) return false;
    const status = error.data?.status ?? error.data?.statusCode;
    if (typeof status === 'number') return [408, 429, 500, 502, 503, 504].includes(status);
    return (
      error.code === JsonRpcErrorCode.Timeout || error.code === JsonRpcErrorCode.ServiceUnavailable
    );
  }

  private httpFailure(error: McpError): McpError {
    const reasons = new Map([
      [JsonRpcErrorCode.InvalidParams, 'http_invalid_params'],
      [JsonRpcErrorCode.Unauthorized, 'http_unauthorized'],
      [JsonRpcErrorCode.Forbidden, 'http_forbidden'],
      [JsonRpcErrorCode.Conflict, 'http_conflict'],
      [JsonRpcErrorCode.RateLimited, 'http_rate_limited'],
      [JsonRpcErrorCode.InvalidRequest, 'http_invalid_request'],
    ]);
    const reason = reasons.get(error.code);
    if (!reason) return error;
    return new McpError(
      error.code,
      error.message,
      { ...error.data, reason, retryable: error.code === JsonRpcErrorCode.RateLimited },
      { cause: error },
    );
  }

  private async exchangeResponse(
    url: URL,
    timeoutMs: number,
    context: Context,
    signal: AbortSignal,
  ): Promise<Response> {
    try {
      return await this.exchange(url, timeoutMs, context, signal);
    } catch (error) {
      if (error instanceof McpError && error.data?.errorSource === 'FetchHttpError')
        throw this.httpFailure(error);
      throw error;
    }
  }

  private async readBody(response: Response, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    if (!response.body) return '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let cancellation: Promise<void> | undefined;
    const abort = () => {
      cancellation = reader.cancel(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      signal.throwIfAborted();
      while (true) {
        const part = await reader.read();
        signal.throwIfAborted();
        if (part.done) break;
        chunks.push(decoder.decode(part.value, { stream: true }));
      }
      chunks.push(decoder.decode());
      return chunks.join('');
    } finally {
      signal.removeEventListener('abort', abort);
      try {
        await cancellation;
      } finally {
        reader.releaseLock();
      }
    }
  }

  /** Build only a relative fixed-origin route and its declared query allowlist. */
  url(
    api: Api,
    path: string,
    query: ParliamentQuery = {},
    allowedKeys: readonly string[] = [],
  ): URL {
    if (
      !path.startsWith('/') ||
      path.startsWith('//') ||
      path.includes('\\') ||
      path.includes('?') ||
      path.includes('#')
    )
      throw validationError('Use a verified relative Parliament API path.');
    const url = new URL(path, PARLIAMENT_ORIGINS[api]);
    if (url.origin !== PARLIAMENT_ORIGINS[api])
      throw validationError('Parliament API origin cannot be changed.');
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      if (!allowedKeys.includes(key))
        throw validationError('Unknown Parliament API query field.', { field: key });
      for (const item of Array.isArray(value) ? value : [value])
        url.searchParams.append(key, String(item));
    }
    return url;
  }

  /** Fetch and fully validate one JSON response; callers reuse the same call for later requests. */
  async get<TSchema extends z.ZodType>(
    call: ParliamentCall,
    api: Api,
    path: string,
    schema: TSchema,
    query: ParliamentQuery = {},
    allowedKeys: readonly string[] = [],
  ): Promise<ParliamentResponse<z.output<TSchema>>> {
    const url = this.url(api, path, query, allowedKeys);
    const queue = this.queue(api);
    const data = await withRetry(
      async (attempt) => {
        call.signal.throwIfAborted();
        await this.acquire(queue, attempt.signal);
        const remainingMs = call.deadlineAt - this.clock.now();
        const controller = new AbortController();
        const timer = this.clock.setTimeout(
          () =>
            controller.abort(
              timeout('Parliament attempt timed out.', { reason: 'attempt_timeout' }),
            ),
          Math.max(0, Math.min(12_000, remainingMs)),
        );
        const signal = AbortSignal.any([attempt.signal, controller.signal]);
        let responseRead = false;
        try {
          signal.throwIfAborted();
          const response = await this.exchangeResponse(
            url,
            Math.max(0, Math.min(12_000, remainingMs)),
            call.context,
            signal,
          );
          if (!response.ok)
            throw this.httpFailure(
              await httpErrorFromResponse(response, {
                captureBody: false,
                service: 'UK Parliament',
              }),
            );
          const text = await this.readBody(response, signal);
          responseRead = true;
          signal.throwIfAborted();
          if (
            response.headers.get('content-type')?.toLowerCase().includes('text/html') ||
            /^\s*<(?:!doctype\s+html|html[\s>])/i.test(text)
          )
            throw serviceUnavailable('Parliament returned an HTML error page instead of JSON.');
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch (cause) {
            throw serializationError('Parliament response was not valid JSON.', undefined, {
              cause,
            });
          }
          const result = schema.safeParse(parsed);
          if (!result.success)
            throw validationError('Parliament JSON did not match the selected API contract.', {
              retryable: false,
            });
          return result.data;
        } catch (error) {
          call.context.signal.throwIfAborted();
          call.signal.throwIfAborted();
          if (controller.signal.aborted) throw controller.signal.reason;
          if (error instanceof McpError && (error.data?.status ?? error.data?.statusCode) === 429) {
            const delayMs = this.retryAfterMs(error.data?.retryAfter);
            queue.cooldownUntil = Math.max(queue.cooldownUntil, this.clock.now() + delayMs);
            throw new McpError(
              error.code,
              error.message,
              { ...error.data, retryAfter: String(delayMs / 1000) },
              { cause: error },
            );
          }
          if (error instanceof TypeError && !responseRead)
            throw serviceUnavailable('Parliament network request failed.', undefined, {
              cause: error,
            });
          throw error;
        } finally {
          this.clock.clearTimeout(timer);
          queue.active--;
          this.dispatch(queue);
        }
      },
      {
        signal: call.signal,
        context: call.context,
        operation: `parliament.${api}`,
        maxRetries: 2,
        baseDelayMs: 1000,
        jitter: 0.25,
        maxDelayMs: 8000,
        isTransient: (error) => this.transient(error),
      },
    );
    call.context.signal.throwIfAborted();
    return {
      data,
      source: {
        api,
        url: url.href,
        retrievedAt: new Date(this.clock.now()).toISOString(),
        licenceUrl: LICENCE_URL,
      },
    };
  }

  /** Cancel active calls and remove all queued waiters/timers during server teardown. */
  dispose(): void {
    this.disposed = true;
    for (const controller of this.calls)
      controller.abort(new DOMException('Parliament transport shut down.', 'AbortError'));
    this.calls.clear();
    for (const queue of this.queues.values()) {
      if (queue.timer !== undefined) this.clock.clearTimeout(queue.timer);
      for (const waiter of queue.waiting.splice(0)) {
        waiter.signal.removeEventListener('abort', waiter.abort);
        waiter.reject(new DOMException('Parliament transport shut down.', 'AbortError'));
      }
    }
  }
}
let service: ParliamentHttpService | undefined;
/** Initialize once in createApp.setup; tests can instantiate the class directly. */
export function initParliamentHttp(
  options: ConstructorParameters<typeof ParliamentHttpService>[0] = {},
): void {
  service = new ParliamentHttpService(options);
}
/** Access the shared transport after setup. */
export function getParliamentHttp(): ParliamentHttpService {
  if (!service)
    throw new Error('Parliament transport not initialized; call initParliamentHttp in setup.');
  return service;
}
/** Dispose shared queues and call deadlines from createApp.teardown. */
export function disposeParliamentHttp(): void {
  service?.dispose();
  service = undefined;
}
