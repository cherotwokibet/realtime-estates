export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export function requireText(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DomainError('INVALID_TEXT', `${label} is required.`);
  }
  return value.trim();
}

export function requireTimestamp(value: string): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new DomainError(
      'INVALID_TIMESTAMP',
      'An ISO timestamp with an explicit timezone is required.',
    );
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > (monthDays[month - 1] ?? 0) ||
    Number(value.slice(11, 13)) > 23 ||
    Number(value.slice(14, 16)) > 59 ||
    Number(value.slice(17, 19)) > 59
  ) {
    throw new DomainError(
      'INVALID_TIMESTAMP',
      'The timestamp must describe a real calendar date and time.',
    );
  }
  return new Date(value).toISOString();
}
