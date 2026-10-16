import { DomainError } from './errors.js';

export interface NumericBound {
  readonly value: number;
  readonly inclusive: boolean;
}
export interface NumericRange {
  readonly min?: NumericBound;
  readonly max?: NumericBound;
}

export function validateNumericRange(range: NumericRange): void {
  for (const bound of [range.min, range.max]) {
    if (bound && (!Number.isFinite(bound.value) || typeof bound.inclusive !== 'boolean')) {
      throw new DomainError(
        'INVALID_RANGE',
        'Each bound needs a finite number and explicit inclusivity.',
      );
    }
  }
  if (
    range.min &&
    range.max &&
    (range.min.value > range.max.value ||
      (range.min.value === range.max.value && (!range.min.inclusive || !range.max.inclusive)))
  ) {
    throw new DomainError('INVALID_RANGE', 'The range must contain at least one possible value.');
  }
}

/** UI labels such as Over X must set inclusive:false; exact bedroom counts use equal inclusive bounds. */
export function matchesNumericRange(value: number, range: NumericRange): boolean {
  validateNumericRange(range);
  if (!Number.isFinite(value)) return false;
  if (range.min && (value < range.min.value || (!range.min.inclusive && value === range.min.value)))
    return false;
  if (range.max && (value > range.max.value || (!range.max.inclusive && value === range.max.value)))
    return false;
  return true;
}

export function exactNumericRange(value: number): NumericRange {
  if (!Number.isFinite(value))
    throw new DomainError('INVALID_RANGE', 'An exact filter must be a finite number.');
  return { min: { value, inclusive: true }, max: { value, inclusive: true } };
}
