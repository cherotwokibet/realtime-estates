import type { PublicSearchInput } from '@realtor/api-client';
import {
  loadMobileReferenceCatalogue,
  type MobileReferenceConfig,
  type MobileReferenceResult,
} from './reference-catalogue.ts';

type Ready = Extract<MobileReferenceResult, { status: 'ready' }>;
export type MobileReferenceReadResult =
  | Extract<MobileReferenceResult, { status: 'error' }>
  | (Ready & Readonly<{ freshness: 'current' | 'previous'; loadedAt: number }>);

/** One public response in memory, bound to this configured company/origin and exact query.
 * No disk cache, private data, automatic retry or alternate/demo catalogue fallback.
 */
export function createMobileReferenceReadSession(
  config: Extract<MobileReferenceConfig, { mode: 'synthetic-reference-public-v1' }>,
  options: { now?: () => number; maxAgeMs?: number; fetch?: typeof globalThis.fetch } = {},
) {
  const scope = Object.freeze({ ...config });
  const now = options.now ?? Date.now;
  const maxAgeMs = options.maxAgeMs ?? 300000;
  const fetch = options.fetch;
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1 || maxAgeMs > 300000)
    throw Error('Invalid previous-response age.');
  let generation = 0;
  let previous: { key: string; result: Ready; loadedAt: number } | null = null;
  const error = Object.freeze({ status: 'error' as const });
  const clock = () => {
    try {
      const value = now();
      return Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000 ? value : null;
    } catch {
      return null;
    }
  };
  return Object.freeze({
    async read(input: PublicSearchInput, signal?: AbortSignal): Promise<MobileReferenceReadResult> {
      const current = ++generation;
      let search: PublicSearchInput;
      let key: string;
      try {
        // These are internal prepared primitive queries; reject accessors and nested values
        // before copying. The SDK independently validates every supported query field.
        if (!input || ![Object.prototype, null].includes(Object.getPrototypeOf(input)))
          return error;
        const captured: Record<string, string | number> = Object.create(null);
        for (const name of Reflect.ownKeys(input).sort()) {
          if (typeof name !== 'string') return error;
          const field = Object.getOwnPropertyDescriptor(input, name);
          if (!field?.enumerable || !Object.hasOwn(field, 'value')) return error;
          if (typeof field.value !== 'string' && typeof field.value !== 'number') return error;
          captured[name] = field.value;
        }
        search = Object.freeze(captured) as PublicSearchInput;
        key = JSON.stringify(search);
      } catch {
        return error;
      }
      if (previous?.key !== key) previous = null;
      if (signal?.aborted) return error;
      const value = await loadMobileReferenceCatalogue(scope, { search, signal, fetch });
      if (generation !== current || signal?.aborted) return error;
      const time = clock();
      if (time === null) {
        previous = null;
        return error;
      }
      if (value.status === 'ready') {
        previous = { key, result: value, loadedAt: time };
        return Object.freeze({ ...value, freshness: 'current', loadedAt: time });
      }
      if (
        value.retryable &&
        previous &&
        time >= previous.loadedAt &&
        time - previous.loadedAt <= maxAgeMs
      )
        return Object.freeze({
          ...previous.result,
          freshness: 'previous',
          loadedAt: previous.loadedAt,
        });
      previous = null;
      return error;
    },
    clear() {
      generation++;
      previous = null;
    },
  });
}
