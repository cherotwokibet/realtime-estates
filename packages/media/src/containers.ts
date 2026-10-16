import { Buffer } from 'node:buffer';

export type SourceFormat = 'jpeg' | 'png' | 'webp';
export type MediaCodecErrorCode =
  | 'INVALID_INPUT'
  | 'INPUT_TOO_LARGE'
  | 'UNSUPPORTED_FORMAT'
  | 'INVALID_IMAGE'
  | 'ANIMATED_INPUT'
  | 'IMAGE_TOO_LARGE'
  | 'OUTPUT_TOO_LARGE';

export class MediaCodecError extends Error {
  override readonly name = 'MediaCodecError';
  constructor(
    readonly code: MediaCodecErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const SYNTHETIC_CODEC_POLICY = Object.freeze({
  maxInputBytes: 10 * 1024 * 1024,
  maxInputPixels: 40_000_000,
  maxInputSide: 16_384,
  maxOutputSide: 1_920,
  maxOutputBytes: 10 * 1024 * 1024,
  quality: 82,
  effort: 4,
} as const);

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const value of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ value) & 255]!;
  return (crc ^ 0xffffffff) >>> 0;
}

function invalid(message: string): never {
  throw new MediaCodecError('INVALID_IMAGE', message);
}
function animated(): never {
  throw new MediaCodecError('ANIMATED_INPUT', 'Only static single-frame inputs are supported.');
}

export function checkDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    invalid('Image dimensions are invalid.');
  }
  // Bound each axis before multiplication, including deliberately forged header dimensions.
  if (
    width > SYNTHETIC_CODEC_POLICY.maxInputSide ||
    height > SYNTHETIC_CODEC_POLICY.maxInputSide ||
    width * height > SYNTHETIC_CODEC_POLICY.maxInputPixels
  ) {
    throw new MediaCodecError('IMAGE_TOO_LARGE', 'Image dimensions exceed the local codec policy.');
  }
}

function inspectPng(input: Buffer): void {
  let offset = 8;
  let chunks = 0;
  let hasPixels = false;
  let hasEnd = false;
  while (offset < input.length) {
    if (input.length - offset < 12) invalid('PNG chunk is truncated.');
    const length = input.readUInt32BE(offset);
    if (length > input.length - offset - 12) invalid('PNG chunk length exceeds the input.');
    // latin1 preserves high bits; Node's ascii decoder masks them and could make a
    // different byte sequence look like an allowed/animation-control chunk name.
    const type = input.toString('latin1', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) invalid('PNG chunk type is invalid.');
    const end = offset + 12 + length;
    if (crc32(input.subarray(offset + 4, end - 4)) !== input.readUInt32BE(end - 4)) {
      invalid('PNG chunk checksum is invalid.');
    }
    if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') animated();
    if (chunks === 0) {
      if (type !== 'IHDR' || length !== 13) invalid('PNG must begin with one IHDR chunk.');
      checkDimensions(input.readUInt32BE(offset + 8), input.readUInt32BE(offset + 12));
    } else if (type === 'IHDR') invalid('PNG has duplicate dimensions.');
    if (type === 'IDAT') hasPixels = true;
    if (type === 'IEND') {
      if (length !== 0 || end !== input.length || !hasPixels)
        invalid('PNG end or pixel data is invalid.');
      hasEnd = true;
    }
    chunks++;
    offset = end;
  }
  if (!hasEnd) invalid('PNG has no complete end chunk.');
}

function inspectWebp(input: Buffer): void {
  if (input.length < 20 || input.readUInt32LE(4) !== input.length - 8)
    invalid('WebP RIFF size is invalid.');
  let offset = 12;
  let hasPixels = false;
  while (offset < input.length) {
    if (input.length - offset < 8) invalid('WebP chunk is truncated.');
    const type = input.toString('latin1', offset, offset + 4);
    if (!/^[\x20-\x7e]{4}$/.test(type)) invalid('WebP chunk type is invalid.');
    const length = input.readUInt32LE(offset + 4);
    if (length > input.length - offset - 8) invalid('WebP chunk length exceeds the input.');
    const end = offset + 8 + length;
    const paddedEnd = end + (length % 2);
    if (paddedEnd > input.length) invalid('WebP chunk padding is truncated.');
    if (type === 'ANIM' || type === 'ANMF') animated();
    if (type === 'VP8X') {
      if (length !== 10) invalid('WebP extended header is invalid.');
      if ((input[offset + 8]! & 0x02) !== 0) animated();
      checkDimensions(1 + input.readUIntLE(offset + 12, 3), 1 + input.readUIntLE(offset + 15, 3));
    }
    if (type === 'VP8 ' || type === 'VP8L') {
      if (hasPixels) invalid('WebP has multiple pixel payloads.');
      hasPixels = true;
    }
    offset = paddedEnd;
  }
  if (!hasPixels) invalid('WebP has no static pixel payload.');
}

function inspectJpeg(input: Buffer): void {
  if (input.length < 4 || input.readUInt16BE(input.length - 2) !== 0xffd9)
    invalid('JPEG is truncated or has trailing bytes.');
  // Bounded marker/container preflight, not a full JPEG decoder. Walk scan boundaries to
  // reject concatenated images rather than silently decoding only their first member.
  // Pixel corruption is checked separately by the actual decoder.
  let offset = 2;
  let hasScan = false;
  while (offset < input.length) {
    if (input[offset] !== 0xff) invalid('JPEG marker is invalid.');
    while (input[offset] === 0xff) offset++;
    const marker = input[offset++];
    if (marker === undefined || marker === 0x00) invalid('JPEG marker is truncated.');
    if (marker === 0xd9) {
      if (!hasScan || offset !== input.length)
        invalid('JPEG has missing pixels, trailing bytes or multiple images.');
      return;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7))
      invalid('Unexpected JPEG standalone marker.');
    if (marker === 0x01) continue;
    if (offset + 2 > input.length) invalid('JPEG segment is truncated.');
    const length = input.readUInt16BE(offset);
    if (length < 2 || length > input.length - offset) invalid('JPEG segment length is invalid.');
    if (
      marker === 0xe2 &&
      length >= 6 &&
      input.toString('latin1', offset + 2, offset + 6) === 'MPF\0'
    )
      animated();
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (length < 8) invalid('JPEG frame header is truncated.');
      checkDimensions(input.readUInt16BE(offset + 5), input.readUInt16BE(offset + 3));
    }
    offset += length;
    if (marker === 0xda) {
      hasScan = true;
      let nextMarker = false;
      while (offset < input.length) {
        if (input[offset] !== 0xff) {
          offset++;
          continue;
        }
        const markerStart = offset++;
        while (input[offset] === 0xff) offset++;
        const scanMarker = input[offset];
        if (
          scanMarker === 0x00 ||
          (scanMarker !== undefined && scanMarker >= 0xd0 && scanMarker <= 0xd7)
        ) {
          offset++;
          continue;
        }
        offset = markerStart;
        nextMarker = true;
        break;
      }
      if (!nextMarker) invalid('JPEG pixel scan is truncated.');
    }
  }
  invalid('JPEG has no complete end marker.');
}

export function inspectContainer(input: Buffer): SourceFormat {
  if (input.length >= 8 && input.subarray(0, 8).equals(PNG_SIGNATURE)) {
    inspectPng(input);
    return 'png';
  }
  if (
    input.length >= 12 &&
    input.toString('latin1', 0, 4) === 'RIFF' &&
    input.toString('latin1', 8, 12) === 'WEBP'
  ) {
    inspectWebp(input);
    return 'webp';
  }
  if (input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) {
    inspectJpeg(input);
    return 'jpeg';
  }
  throw new MediaCodecError(
    'UNSUPPORTED_FORMAT',
    'Only static JPEG, PNG and WebP containers are supported.',
  );
}
