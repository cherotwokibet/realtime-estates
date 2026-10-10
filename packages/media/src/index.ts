import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { checkDimensions, inspectContainer, MediaCodecError, SYNTHETIC_CODEC_POLICY, type SourceFormat } from './containers.js';

export { MediaCodecError, SYNTHETIC_CODEC_POLICY } from './containers.js';
export type { MediaCodecErrorCode, SourceFormat } from './containers.js';

export interface SyntheticCodecOptions {
  /** Trusted local caller may lower, never raise, the post-encode output byte cap. */
  readonly maxOutputBytes?: number;
}

export interface SyntheticImageManifest {
  readonly pipeline: 'synthetic-codec-v1';
  readonly sourceFormat: SourceFormat;
  readonly inputSha256: string;
  readonly inputBytes: number;
  readonly format: 'webp';
  readonly mimeType: 'image/webp';
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly encoder: Readonly<{ sharp: string; vips: string }>;
  readonly operations: readonly ['auto-orient', 'resize-inside-1920-without-enlargement', 'strip-metadata', 'webp-quality-82-effort-4'];
}

export interface SyntheticImageResult {
  /** Newly encoded, private in-memory bytes. The caller owns the mutable Buffer. */
  readonly data: Buffer;
  /** Immutable description of data at return time; changing data invalidates its hash. */
  readonly manifest: SyntheticImageManifest;
}

function sha256(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }

/**
 * Experimental local byte-conversion proof. This is NOT an upload endpoint, a sandbox,
 * a storage adapter, a trusted-media acceptance receipt or production verification.
 */
export async function convertSyntheticImage(input: Buffer, options: SyntheticCodecOptions = {}): Promise<SyntheticImageResult> {
  if (!Buffer.isBuffer(input) || input.length === 0) throw new MediaCodecError('INVALID_INPUT', 'A non-empty Buffer is required.');
  if (input.length > SYNTHETIC_CODEC_POLICY.maxInputBytes) throw new MediaCodecError('INPUT_TOO_LARGE', 'Input exceeds 10 MiB.');
  const maxOutputBytes = options.maxOutputBytes ?? SYNTHETIC_CODEC_POLICY.maxOutputBytes;
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > SYNTHETIC_CODEC_POLICY.maxOutputBytes) {
    throw new MediaCodecError('INVALID_INPUT', 'Output cap must be a positive integer no larger than the fixed policy.');
  }
  // Snapshot before the first await: ordinary caller mutations cannot change the hashed
  // input between preflight and decode. No concurrent SharedArrayBuffer trust is claimed.
  const source = Buffer.from(input);
  const sourceFormat = inspectContainer(source);
  const inputSha256 = sha256(source);
  const image = sharp(source, { failOn: 'warning', limitInputPixels: SYNTHETIC_CODEC_POLICY.maxInputPixels, unlimited: false });
  let warned = false;
  image.on('warning', () => { warned = true; });
  try {
    const metadata = await image.metadata();
    if (metadata.format !== sourceFormat) throw new MediaCodecError('INVALID_IMAGE', 'Decoder format does not match the container.');
    if ((metadata.pages ?? 1) !== 1 || (metadata.pageHeight !== undefined && metadata.pageHeight !== metadata.height) ||
        (metadata.delay?.length ?? 0) > 0 || metadata.loop !== undefined) {
      throw new MediaCodecError('ANIMATED_INPUT', 'Only static single-frame inputs are supported.');
    }
    checkDimensions(metadata.width, metadata.height);
    const { data, info } = await image.autoOrient()
      .resize({ width: SYNTHETIC_CODEC_POLICY.maxOutputSide, height: SYNTHETIC_CODEC_POLICY.maxOutputSide, fit: 'inside', withoutEnlargement: true })
      // Sharp strips source metadata by default; do not call keepMetadata/withMetadata.
      .webp({ quality: SYNTHETIC_CODEC_POLICY.quality, effort: SYNTHETIC_CODEC_POLICY.effort })
      .toBuffer({ resolveWithObject: true });
    if (warned) throw new MediaCodecError('INVALID_IMAGE', 'The decoder emitted a warning.');
    if (data.length > maxOutputBytes) throw new MediaCodecError('OUTPUT_TOO_LARGE', 'Encoded output exceeds the configured byte cap.');
    if (info.format !== 'webp' || info.width < 1 || info.height < 1 ||
        info.width > SYNTHETIC_CODEC_POLICY.maxOutputSide || info.height > SYNTHETIC_CODEC_POLICY.maxOutputSide ||
        (info.pages ?? 1) !== 1) {
      throw new MediaCodecError('INVALID_IMAGE', 'Encoded output did not satisfy the codec policy.');
    }
    const manifest: SyntheticImageManifest = Object.freeze({
      pipeline: 'synthetic-codec-v1', sourceFormat, inputSha256, inputBytes: source.length,
      format: 'webp', mimeType: 'image/webp', sha256: sha256(data), width: info.width, height: info.height, bytes: data.length,
      encoder: Object.freeze({ sharp: sharp.versions.sharp, vips: sharp.versions.vips }),
      operations: Object.freeze(['auto-orient', 'resize-inside-1920-without-enlargement', 'strip-metadata', 'webp-quality-82-effort-4'] as const),
    });
    return Object.freeze({ data, manifest });
  } catch (error) {
    if (error instanceof MediaCodecError) throw error;
    // Native diagnostic strings can contain implementation details. Keep callers on a
    // narrow local error contract rather than treating metadata parsing as success.
    throw new MediaCodecError('INVALID_IMAGE', 'Image decoding or encoding failed.');
  } finally {
    image.destroy();
  }
}
