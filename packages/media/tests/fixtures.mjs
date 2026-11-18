// Independently authored synthetic fixtures only. No property/customer/vendor images.
// PNG construction uses the PNG container layout + Node zlib, not Sharp's PNG encoder.
import { deflateSync } from 'node:zlib';

export const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function pngChunk(type, data = Buffer.alloc(0)) {
  const body = Buffer.concat([Buffer.isBuffer(type) ? type : Buffer.from(type, 'ascii'), data]);
  let crc = 0xffffffff;
  // Deliberately independent bit-at-a-time CRC rather than the codec's lookup table.
  for (const value of body) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, body, checksum]);
}

function ihdr(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6; // RGBA, non-interlaced, filter method0.
  return pngChunk('IHDR', header);
}

function pixels(width, height, pixel = () => [40, 110, 180, 255]) {
  const raw = Buffer.alloc((1 + width * 4) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // PNG None filter.
    for (let x = 0; x < width; x++)
      Buffer.from(pixel(x, y)).copy(raw, y * (1 + width * 4) + 1 + x * 4);
  }
  return deflateSync(raw);
}

export function syntheticPng(width = 16, height = 12, pixel, extra = []) {
  return Buffer.concat([
    pngSignature,
    ihdr(width, height),
    ...extra,
    pngChunk('IDAT', pixels(width, height, pixel)),
    pngChunk('IEND'),
  ]);
}

export function syntheticGalleryPng(index) {
  return syntheticPng(320 + index * 8, 240, (x, y) => [
    (x * 2 + index * 53) % 256,
    (y * 3 + index * 31) % 256,
    (x + y + index * 23) % 256,
    255,
  ]);
}

// Complete PNG container with forged dimensions but tiny data. Used ONLY to prove
// header bounds reject before allocation; it is not advertised as a valid large image.
export function dimensionHeaderPng(width, height) {
  return Buffer.concat([
    pngSignature,
    ihdr(width, height),
    pngChunk('IDAT', pixels(1, 1)),
    pngChunk('IEND'),
  ]);
}

export function syntheticApng() {
  const control = Buffer.alloc(8);
  control.writeUInt32BE(2, 0);
  function frame(sequence) {
    const data = Buffer.alloc(26);
    data.writeUInt32BE(sequence, 0);
    data.writeUInt32BE(2, 4);
    data.writeUInt32BE(2, 8);
    data.writeUInt16BE(1, 20);
    data.writeUInt16BE(10, 22);
    return pngChunk('fcTL', data);
  }
  const secondFrame = Buffer.alloc(4);
  secondFrame.writeUInt32BE(2);
  return Buffer.concat([
    pngSignature,
    ihdr(2, 2),
    pngChunk('acTL', control),
    frame(0),
    pngChunk(
      'IDAT',
      pixels(2, 2, () => [255, 0, 0, 255]),
    ),
    frame(1),
    pngChunk('fdAT', Buffer.concat([secondFrame, pixels(2, 2, () => [0, 0, 255, 255])])),
    pngChunk('IEND'),
  ]);
}

export function riffChunk(type, data) {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(data.length);
  return Buffer.concat([
    Buffer.from(type, 'ascii'),
    size,
    data,
    ...(data.length % 2 ? [Buffer.alloc(1)] : []),
  ]);
}

export function webpContainer(chunks) {
  const body = Buffer.concat([Buffer.from('WEBP'), ...chunks]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from('RIFF'), size, body]);
}

export function corruptPngCompressedData() {
  return Buffer.concat([
    pngSignature,
    ihdr(8, 8),
    pngChunk('IDAT', Buffer.from('not a zlib image')),
    pngChunk('IEND'),
  ]);
}
