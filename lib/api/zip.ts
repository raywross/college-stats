/**
 * A tiny zip writer (store method, no compression) for the downloadable skill (lib/api/skill.ts): a handful of text
 * files, deterministic bytes (a fixed timestamp), no dependency. Enough for every unzip tool and the assistants'
 * skill uploaders; not a general archiver.
 */
import { crc32 } from "node:zlib";

export interface ZipEntry {
  /** Path inside the archive, forward slashes, no leading slash. */
  name: string;
  data: Uint8Array | string;
}

const FIXED_DOS_TIME = 0x0000; // 00:00:00
const FIXED_DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01, so the bytes don't change per build

function u16(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff];
}
function u32(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}

export function zipStore(entries: readonly ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const locals: number[] = [];
  const central: number[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data;
    const crc = crc32(data) >>> 0;
    const header = [
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(FIXED_DOS_TIME), ...u16(FIXED_DOS_DATE),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0),
    ];
    locals.push(...header, ...name, ...data);
    central.push(
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(FIXED_DOS_TIME), ...u16(FIXED_DOS_DATE),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(offset), ...name,
    );
    offset += header.length + name.length + data.length;
  }
  const end = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length), ...u32(central.length), ...u32(offset), ...u16(0)];
  return Uint8Array.from([...locals, ...central, ...end]);
}

/** The file names a zip holds, read back from its central directory (for tests). */
export function zipNames(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  if (view.getUint32(eocd, true) !== 0x06054b50) throw new Error("not a zip (no end record)");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const names: string[] = [];
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("bad central directory");
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    names.push(decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength)));
    p += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

/** One stored file's bytes, by name (for tests). */
export function zipRead(bytes: Uint8Array, name: string): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let p = 0;
  while (p + 30 <= bytes.length && view.getUint32(p, true) === 0x04034b50) {
    const size = view.getUint32(p + 18, true);
    const nameLength = view.getUint16(p + 26, true);
    const extraLength = view.getUint16(p + 28, true);
    const entryName = decoder.decode(bytes.subarray(p + 30, p + 30 + nameLength));
    const start = p + 30 + nameLength + extraLength;
    if (entryName === name) return bytes.subarray(start, start + size);
    p = start + size;
  }
  return null;
}
