import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value ^ 0xffffffff;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc(body) >>> 0);
  return Buffer.concat([length, body, checksum]);
}

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const index = row + 1 + x * 4;
      const cx = x - size / 2;
      const cy = y - size * 0.42;
      const spade = cy < size * 0.12 && cx * cx + cy * cy < (size * 0.22) ** 2;
      const stem = Math.abs(cx) < size * 0.06 && y > size * 0.48 && y < size * 0.72;
      const gold = spade || stem;
      raw[index] = gold ? 212 : 9;
      raw[index + 1] = gold ? 175 : 13;
      raw[index + 2] = gold ? 55 : 18;
      raw[index + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

writeFileSync(new URL("../public/icon-192.png", import.meta.url), png(192));
writeFileSync(new URL("../public/icon-512.png", import.meta.url), png(512));
