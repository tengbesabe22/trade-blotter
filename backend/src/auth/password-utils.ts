import { scrypt, timingSafeEqual } from 'node:crypto';

// Unknown emails still run the same expensive hash check before returning 401.
export const dummyPasswordHash = `scrypt$131072$8$1$${'00'.repeat(16)}$${'00'.repeat(64)}`;

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  // Accept the seed's format and fixed work factors; never trust arbitrary costs.
  const parts = /^scrypt\$131072\$8\$1\$([0-9a-f]{32})\$([0-9a-f]{128})$/.exec(encoded);
  if (!parts) return false;

  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const actual = await new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      expected.length,
      {
        N: 131072,
        r: 8,
        p: 1,
        maxmem: 256 * 1024 * 1024,
      },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });

  return timingSafeEqual(expected, actual);
}
