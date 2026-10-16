import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { isSharedArrayBuffer } from 'node:util/types';
import { inspectContainer, SYNTHETIC_CODEC_POLICY } from './containers.js';
import type { SyntheticImageResult } from './index.js';

export class MediaReadbackError extends Error {
  override readonly name = 'MediaReadbackError';
  constructor() {
    super('Synthetic processor output failed bounded byte/manifest readback.');
  }
}
const ENCODER = Object.freeze({ sharp: '0.35.5', vips: '8.18.7' });
const OPERATIONS = Object.freeze([
  'auto-orient',
  'resize-inside-1920-without-enlargement',
  'strip-metadata',
  'webp-quality-82-effort-4',
] as const);
function reject(): never {
  throw new MediaReadbackError();
}
function hash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join('|') !== [...keys].sort().join('|')
  )
    reject();
  return value as Record<string, unknown>;
}
function dimension(value: number): void {
  if (value < 1 || value > SYNTHETIC_CODEC_POLICY.maxOutputSide) reject();
}

/** Pure byte/header check, not a native decode or a security sandbox. */
function outputDimensions(bytes: Buffer): { width: number; height: number } {
  if (
    bytes.length < 20 ||
    bytes.toString('latin1', 0, 4) !== 'RIFF' ||
    bytes.toString('latin1', 8, 12) !== 'WEBP' ||
    bytes.readUInt32LE(4) + 8 !== bytes.length
  )
    reject();
  let offset = 12;
  let canvas: { width: number; height: number; alpha: boolean } | undefined;
  let coded: { width: number; height: number; alpha: boolean; kind: string } | undefined;
  let alpha = false;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) reject();
    const kind = bytes.toString('latin1', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const end = offset + 8 + size;
    const next = end + (size % 2);
    if (next > bytes.length || (size % 2 && bytes[end] !== 0)) reject();
    const body = bytes.subarray(offset + 8, end);
    if (kind === 'VP8X') {
      if (
        offset !== 12 ||
        canvas ||
        size !== 10 ||
        (body[0]! & ~0x10) !== 0 ||
        body[1] !== 0 ||
        body[2] !== 0 ||
        body[3] !== 0
      )
        reject();
      canvas = {
        width: body.readUIntLE(4, 3) + 1,
        height: body.readUIntLE(7, 3) + 1,
        alpha: (body[0]! & 0x10) !== 0,
      };
    } else if (kind === 'ALPH') {
      if (!canvas?.alpha || alpha || coded || size < 1) reject();
      alpha = true;
    } else if (kind === 'VP8 ') {
      if (
        coded ||
        size < 10 ||
        (body[0]! & 1) !== 0 ||
        body[3] !== 0x9d ||
        body[4] !== 0x01 ||
        body[5] !== 0x2a ||
        (body.readUInt16LE(6) & 0xc000) !== 0 ||
        (body.readUInt16LE(8) & 0xc000) !== 0
      )
        reject();
      coded = {
        width: body.readUInt16LE(6) & 0x3fff,
        height: body.readUInt16LE(8) & 0x3fff,
        alpha,
        kind,
      };
    } else if (kind === 'VP8L') {
      if (coded || alpha || size < 5 || body[0] !== 0x2f) reject();
      const header = body.readUInt32LE(1);
      if (header >>> 29 !== 0) reject();
      coded = {
        width: (header & 0x3fff) + 1,
        height: ((header >>> 14) & 0x3fff) + 1,
        alpha: ((header >>> 28) & 1) === 1,
        kind,
      };
    } else {
      // Fresh output permits no animation, source metadata or unknown extension chunks.
      reject();
    }
    offset = next;
  }
  if (
    !coded ||
    offset !== bytes.length ||
    (canvas &&
      (canvas.width !== coded.width ||
        canvas.height !== coded.height ||
        canvas.alpha !== coded.alpha))
  )
    reject();
  dimension(coded.width);
  dimension(coded.height);
  return { width: coded.width, height: coded.height };
}

/**
 * Trusted local coordinator calls this only AFTER a confirmed empty-job barrier.
 * It snapshots actual buffers and compares a bounded canonical JSON sidecar with
 * actual input/output hashes and WebP coded dimensions, without importing Sharp.
 * It does not prove entropy decoding, process termination, authorization or SQL acceptance.
 */
export function verifySyntheticProcessReadback(
  input: Buffer,
  output: Buffer,
  sidecar: Buffer,
): SyntheticImageResult {
  try {
    if (
      ![input, output, sidecar].every(Buffer.isBuffer) ||
      input.length < 1 ||
      input.length > SYNTHETIC_CODEC_POLICY.maxInputBytes ||
      output.length < 1 ||
      output.length > SYNTHETIC_CODEC_POLICY.maxOutputBytes ||
      sidecar.length < 1 ||
      sidecar.length > 4096 ||
      [input, output, sidecar].some((value) => isSharedArrayBuffer(value.buffer))
    )
      reject();
    const source = Buffer.from(input);
    const data = Buffer.from(output);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(sidecar).trim();
    const parsed: unknown = JSON.parse(text);
    // The owned worker writes JSON.stringify. Exact canonical readback rejects duplicate
    // keys, escaped aliases, rounded number literals and invalid UTF-8 replacement aliases.
    if (JSON.stringify(parsed) !== text) reject();
    const m = object(parsed, [
      'pipeline',
      'sourceFormat',
      'inputSha256',
      'inputBytes',
      'format',
      'mimeType',
      'sha256',
      'width',
      'height',
      'bytes',
      'encoder',
      'operations',
    ]);
    const encoder = object(m.encoder, ['sharp', 'vips']);
    const size = outputDimensions(data);
    const sourceFormat = inspectContainer(source);
    if (
      m.pipeline !== 'synthetic-codec-v1' ||
      m.sourceFormat !== sourceFormat ||
      m.inputSha256 !== hash(source) ||
      m.inputBytes !== source.length ||
      m.format !== 'webp' ||
      m.mimeType !== 'image/webp' ||
      m.sha256 !== hash(data) ||
      m.bytes !== data.length ||
      m.width !== size.width ||
      m.height !== size.height ||
      encoder.sharp !== ENCODER.sharp ||
      encoder.vips !== ENCODER.vips ||
      !Array.isArray(m.operations) ||
      JSON.stringify(m.operations) !== JSON.stringify(OPERATIONS)
    )
      reject();
    return Object.freeze({
      data,
      manifest: Object.freeze({
        pipeline: 'synthetic-codec-v1',
        sourceFormat,
        inputSha256: hash(source),
        inputBytes: source.length,
        format: 'webp',
        mimeType: 'image/webp',
        sha256: hash(data),
        width: size.width,
        height: size.height,
        bytes: data.length,
        encoder: ENCODER,
        operations: OPERATIONS,
      }),
    });
  } catch {
    throw new MediaReadbackError();
  }
}
