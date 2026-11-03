import { parseListingReportJson } from './listing-reports.js';

export type ListingVideo = Readonly<{
  provider: 'youtube' | 'vimeo';
  videoId: string;
  title: string;
}>;
export interface ListingVideoCommand {
  readonly policy: 'synthetic-listing-video-command-v1';
  readonly operationId: string;
  readonly listingId: string;
  readonly revision: number;
  readonly expectedVersion: string;
  readonly video: ListingVideo | null;
}
export interface ListingVideoRecord {
  readonly policy: 'synthetic-listing-video-record-v1';
  readonly command: ListingVideoCommand;
  readonly actorId: string;
  readonly resultVersion: string;
}
export interface ListingVideoState {
  readonly policy: 'synthetic-listing-video-state-v1';
  readonly listingId: string;
  readonly revision: number;
  readonly version: string;
  readonly video: ListingVideo | null;
}
export interface PublishedListingVideo {
  readonly policy: 'synthetic-published-listing-video-v1';
  readonly listingId: string;
  readonly revision: number;
  readonly approvedVersion: string;
  readonly video: ListingVideo | null;
}
export function validatePublishedListingVideo(
  v: unknown,
  listingId: string,
  revision: number,
): PublishedListingVideo {
  const r = exact(v, ['policy', 'listingId', 'revision', 'approvedVersion', 'video']);
  listingVideoTarget(r.listingId, r.revision);
  if (
    r.policy !== 'synthetic-published-listing-video-v1' ||
    r.listingId !== listingId ||
    r.revision !== revision
  )
    return fail();
  return Object.freeze({
    policy: r.policy,
    listingId,
    revision,
    approvedVersion: version(r.approvedVersion),
    video: validateListingVideo(r.video),
  });
}
const fail = (): never => {
  throw Error('Invalid private listing video facts.');
};
function exact(v: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!v || typeof v !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(v)))
    return fail();
  const keys = Reflect.ownKeys(v),
    out: Record<string, unknown> = {};
  if (
    keys.length !== fields.length ||
    keys.some((k) => typeof k !== 'string' || !fields.includes(k))
  )
    return fail();
  for (const k of fields) {
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return fail();
    out[k] = d.value;
  }
  return out;
}
export function listingVideoTarget(listingId: unknown, revision: unknown) {
  if (
    typeof listingId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(listingId) ||
    typeof revision !== 'number' ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    revision > 2147483647
  )
    return fail();
  return Object.freeze({ listingId, revision });
}
function version(v: unknown): string {
  if (typeof v !== 'string' || !/^[1-9][0-9]{0,15}$/.test(v) || BigInt(v) > 9007199254740991n)
    return fail();
  return v;
}
export function validateListingVideo(v: unknown): ListingVideo | null {
  if (v === null) return null;
  const r = exact(v, ['provider', 'videoId', 'title']);
  if (
    (r.provider !== 'youtube' && r.provider !== 'vimeo') ||
    typeof r.videoId !== 'string' ||
    !(r.provider === 'youtube' ? /^[A-Za-z0-9_-]{11}$/ : /^[1-9][0-9]{0,11}$/).test(r.videoId) ||
    typeof r.title !== 'string' ||
    [...r.title].length < 1 ||
    [...r.title].length > 120 ||
    r.title !== r.title.trim() ||
    r.title !== r.title.normalize('NFC') ||
    /[\u0000-\u001f\u007f-\u009f<>\u202a-\u202e\u2066-\u2069\ud800-\udfff]/u.test(r.title)
  )
    return fail();
  return Object.freeze({ provider: r.provider, videoId: r.videoId, title: r.title });
}
export function parseListingVideoJson(source: string): unknown {
  if (typeof source !== 'string' || new TextEncoder().encode(source).byteLength > 2048)
    return fail();
  return parseListingReportJson(source);
}
export function validateListingVideoCommand(v: unknown): ListingVideoCommand {
  const r = exact(v, [
    'policy',
    'operationId',
    'listingId',
    'revision',
    'expectedVersion',
    'video',
  ]);
  if (r.policy !== 'synthetic-listing-video-command-v1') return fail();
  listingVideoTarget(r.operationId, 1);
  const target = listingVideoTarget(r.listingId, r.revision),
    expectedVersion = version(r.expectedVersion);
  if (expectedVersion === '9007199254740991') return fail();
  return Object.freeze({
    policy: r.policy,
    operationId: r.operationId as string,
    ...target,
    expectedVersion,
    video: validateListingVideo(r.video),
  });
}
export function validateListingVideoRecord(
  v: unknown,
  original?: ListingVideoCommand,
): ListingVideoRecord {
  const r = exact(v, ['policy', 'command', 'actorId', 'resultVersion']),
    command = validateListingVideoCommand(r.command);
  listingVideoTarget(r.actorId, 1);
  const resultVersion = version(r.resultVersion);
  if (
    r.policy !== 'synthetic-listing-video-record-v1' ||
    BigInt(resultVersion) !== BigInt(command.expectedVersion) + 1n ||
    (original && JSON.stringify(command) !== JSON.stringify(validateListingVideoCommand(original)))
  )
    return fail();
  return Object.freeze({ policy: r.policy, command, actorId: r.actorId as string, resultVersion });
}
export function validateListingVideoState(
  v: unknown,
  listingId: string,
  revision: number,
): ListingVideoState {
  const r = exact(v, ['policy', 'listingId', 'revision', 'version', 'video']);
  listingVideoTarget(r.listingId, r.revision);
  if (
    r.policy !== 'synthetic-listing-video-state-v1' ||
    r.listingId !== listingId ||
    r.revision !== revision
  )
    return fail();
  return Object.freeze({
    policy: r.policy,
    listingId,
    revision,
    version: version(r.version),
    video: validateListingVideo(r.video),
  });
}
/** Explicit outbound navigation only. No embed, thumbnail, prefetch or provider request. */
export function listingVideoExternalLink(input: ListingVideo): string {
  const v = validateListingVideo(input);
  if (!v) return fail();
  return v.provider === 'youtube'
    ? 'https://www.youtube.com/watch?v=' + v.videoId
    : 'https://vimeo.com/' + v.videoId;
}
