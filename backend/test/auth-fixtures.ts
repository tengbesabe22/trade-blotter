import { scryptSync } from 'node:crypto';
import type { AuthRepository, CurrentUser, NewSession } from '../src/auth/auth-repository';

export const origin = 'http://localhost:5173';
export const password = 'Test password with spaces ';
const salt = Buffer.alloc(16, 1);
const key = scryptSync(password, salt, 64, {
  N: 131072,
  r: 8,
  p: 1,
  maxmem: 256 * 1024 * 1024,
});

export const user: CurrentUser & { passwordHash: string } = {
  id: 'd197282d-99ca-4260-833a-702f97d1cba1',
  displayName: 'JSMITH',
  role: 'TRADER',
  passwordHash: `scrypt$131072$8$1$${salt.toString('hex')}$${key.toString('hex')}`,
};

// This fake replaces database I/O; timeout and permission rules remain real code.
export function createAuthFixture() {
  const users = new Map([['jsmith@example.com', { ...user }]]);
  const sessions = new Map<string, NewSession>();
  const createdSessions: NewSession[] = [];
  const lookups: string[] = [];

  const repository: AuthRepository = {
    findUser: async (email) => {
      lookups.push(email);

      return users.get(email) ?? null;
    },

    createSession: async (session) => {
      createdSessions.push({ ...session });
      sessions.set(session.tokenHash, { ...session });
    },

    findSession: async (tokenHash) => {
      const session = sessions.get(tokenHash);
      const owner = [...users.values()].find((candidate) => candidate.id === session?.userId);

      if (!session || !owner) return null;

      return {
        lastSeenAt: session.lastSeenAt,
        expiresAt: session.expiresAt,
        user: { id: owner.id, displayName: owner.displayName, role: owner.role },
      };
    },

    touchSession: async (tokenHash, now) => {
      const session = sessions.get(tokenHash);

      if (!session) return false;

      session.lastSeenAt = now;

      return true;
    },

    deleteSession: async (tokenHash) => {
      sessions.delete(tokenHash);
    },
  };

  return { repository, users, sessions, createdSessions, lookups };
}
