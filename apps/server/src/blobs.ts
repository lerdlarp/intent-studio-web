import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

export class TooLargeError extends Error {}

/** Content-addressed blob directory (filesystem; swap for an S3-compatible store behind the same shape later). */
export class BlobStore {
  constructor(readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  pathFor(sha256: string): string {
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('bad hash');
    return path.join(this.dir, sha256);
  }

  has(sha256: string): boolean {
    return fs.existsSync(this.pathFor(sha256));
  }

  read(sha256: string): fs.ReadStream {
    return fs.createReadStream(this.pathFor(sha256));
  }

  /** Stream into a temp file while hashing; throws TooLargeError past `maxBytes`. Dedupes by content hash. */
  async put(stream: Readable, maxBytes: number): Promise<{ sha256: string; size: number }> {
    const tmp = path.join(this.dir, `.tmp-${crypto.randomUUID()}`);
    const hash = crypto.createHash('sha256');
    let size = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        size += chunk.length;
        if (size > maxBytes) return cb(new TooLargeError('file too large'));
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    try {
      await pipeline(stream, meter, fs.createWriteStream(tmp));
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      throw e;
    }
    const sha256 = hash.digest('hex');
    if (this.has(sha256)) fs.rmSync(tmp, { force: true });
    else fs.renameSync(tmp, this.pathFor(sha256));
    return { sha256, size };
  }

  /** Read the first `n` bytes (for sniffing). */
  head(sha256: string, n: number): Buffer {
    const fd = fs.openSync(this.pathFor(sha256), 'r');
    try {
      const buf = Buffer.alloc(n);
      const read = fs.readSync(fd, buf, 0, n, 0);
      return buf.subarray(0, read);
    } finally {
      fs.closeSync(fd);
    }
  }
}
