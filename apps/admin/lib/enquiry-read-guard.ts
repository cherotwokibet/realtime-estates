export interface EnquiryReadGuard {
  capture(): () => boolean;
  invalidate(): void;
}

/**
 * Retire every earlier read after a denial or workspace teardown. An aborted
 * transport may still complete, so callers check the captured predicate just
 * before applying a result. This gate supplies no authorization or cancellation.
 */
export function createEnquiryReadGuard(): EnquiryReadGuard {
  let generation = {};
  return Object.freeze({
    capture() {
      const captured = generation;
      return () => generation === captured;
    },
    invalidate() {
      generation = {};
    },
  });
}
