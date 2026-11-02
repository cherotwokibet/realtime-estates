import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateListingVideo,
  validateListingVideoCommand,
  validateListingVideoRecord,
  validateListingVideoState,
  parseListingVideoJson,
  listingVideoExternalLink,
} from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const video = { provider: 'youtube', videoId: 'abcdefghijk', title: 'Synthetic tour' };
const command = () => ({
  policy: 'synthetic-listing-video-command-v1',
  operationId: id(1),
  listingId: id(2),
  revision: 1,
  expectedVersion: '1',
  video: { ...video },
});
test('video commands snapshot canonical provider identifiers without arbitrary URLs or private metadata', () => {
  const c = command(),
    saved = validateListingVideoCommand(c);
  c.video.title = 'Changed';
  assert.equal(saved.video.title, video.title);
  assert.ok(Object.isFrozen(saved.video));
  assert.equal(
    listingVideoExternalLink(saved.video),
    'https://www.youtube.com/watch?v=abcdefghijk',
  );
  assert.equal(
    listingVideoExternalLink({ provider: 'vimeo', videoId: '1234567', title: 'Synthetic' }),
    'https://vimeo.com/1234567',
  );
  assert.equal(validateListingVideo(null), null);
});
test('untrusted URLs, tracking IDs, markup, control and directional text are refused', () => {
  for (const v of [
    { ...video, provider: 'other' },
    { ...video, videoId: 'abcdefghijk?x=1' },
    { ...video, url: 'https://private.test' },
    { ...video, title: '<iframe>' },
    { ...video, title: ' Tour ' },
    { ...video, title: 'tour\u0085private' },
    { ...video, title: 'tour\u202ehidden' },
    { ...video, title: 'e\u0301' },
    { ...video, title: 'x'.repeat(121) },
    { ...video, videoId: 'https://x.y' },
  ])
    assert.throws(() => validateListingVideo(v));
  assert.equal(validateListingVideo({ ...video, title: '🦒'.repeat(120) }).title.length, 240);
});
test('accessors, symbols, exotic prototypes and missing fields do not execute or invent defaults', () => {
  let invoked = 0;
  assert.throws(() =>
    validateListingVideo({
      provider: 'youtube',
      videoId: 'abcdefghijk',
      get title() {
        invoked++;
        return 'x';
      },
    }),
  );
  assert.equal(invoked, 0);
  for (const v of [
    { ...command(), [Symbol()]: 1 },
    Object.assign(Object.create({}), command()),
    { ...command(), video: undefined },
    { ...command(), expectedVersion: '9007199254740991' },
    { ...command(), revision: 2147483648 },
  ])
    assert.throws(() => validateListingVideoCommand(v));
});
test('raw JSON refuses escaped duplicate keys, rounded revisions and oversized input', () => {
  const raw = JSON.stringify(command());
  assert.deepEqual(parseListingVideoJson(raw), command());
  for (const s of [
    raw.replace('"revision":1', '"revision":1e0'),
    raw.replace('"revision":1', '"revision":1.00000000000000001'),
    raw.replace('"revision":1', '"revision":1,"revis\\u0069on":1'),
    ' '.repeat(2049),
  ])
    assert.throws(() => parseListingVideoJson(s));
});
test('original records bind all command fields and one exact version increment', () => {
  const c = command(),
    r = {
      policy: 'synthetic-listing-video-record-v1',
      command: c,
      actorId: id(3),
      resultVersion: '2',
    };
  assert.deepEqual(validateListingVideoRecord(r, c).command, c);
  for (const altered of [
    { ...r, resultVersion: '3' },
    { ...r, actorId: 'x' },
    { ...r, command: { ...c, video: null } },
    { ...r, unexpected: true },
  ])
    assert.throws(() => validateListingVideoRecord(altered, c));
});
test('current video states bind listing and revision independently of old original versions', () => {
  const s = {
    policy: 'synthetic-listing-video-state-v1',
    listingId: id(2),
    revision: 1,
    version: '9',
    video: null,
  };
  assert.equal(validateListingVideoState(s, id(2), 1).video, null);
  assert.throws(() => validateListingVideoState(s, id(4), 1));
  assert.throws(() => validateListingVideoState(s, id(2), 2));
});
