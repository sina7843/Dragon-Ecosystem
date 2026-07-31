import { Buffer } from 'node:buffer';
import { deflateRawSync, crc32 } from 'node:zlib';

/**
 * Minimal ZIP writer, because a `.docx` is a ZIP and adding a dependency to produce
 * documentation would put a third-party package in the release path of the product repo.
 *
 * Only what OOXML needs: stored or deflated entries, no encryption, no ZIP64. The archives
 * this produces are a few megabytes of XML and PNG, comfortably inside the 32-bit limits.
 */

const DOS_TIME = 0; // Fixed timestamp: a rebuild with identical input produces an identical file.
const DOS_DATE = 0x21; // 1980-01-01, the ZIP epoch.

function crc(buffer) {
  // node:zlib exposes crc32 from v20.15/22.2; fall back to a local table if absent.
  if (typeof crc32 === 'function') return crc32(buffer) >>> 0;
  let c = ~0;
  for (const byte of buffer) {
    c ^= byte;
    for (let i = 0; i < 8; i += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

export function zip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const { name, data, store = false } of entries) {
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const body = store ? raw : deflateRawSync(raw, { level: 9 });
    const method = store ? 0 : 8;
    const nameBuf = Buffer.from(name, 'utf8');
    const signature = crc(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(signature, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, body);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(DOS_TIME, 12);
    dir.writeUInt16LE(DOS_DATE, 14);
    dir.writeUInt32LE(signature, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(0, 38); // external attributes
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...chunks, centralBuf, end]);
}
