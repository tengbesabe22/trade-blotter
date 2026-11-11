import type { DatabaseClient } from '@trade-blotter/database';
import { SESSION_IDLE_TIMEOUT_MS } from './session';

export type CurrentUser = {
  id: string;
  displayName: string;
  role: 'TRADER' | 'READ_ONLY';
};

type LoginUser = CurrentUser & { passwordHash: string };

export type NewSession = {
  userId: string;
  tokenHash: string;
  lastSeenAt: Date;
  expiresAt: Date;
};

export type StoredSession = {
  user: CurrentUser;
  lastSeenAt: Date;
  expiresAt: Date;
};

export type AuthStore = {
  findUser: (email: string) => Promise<LoginUser | null>;
  createSession: (session: NewSession) => Promise<void>;
  findSession: (tokenHash: string) => Promise<StoredSession | null>;
  touchSession: (tokenHash: string, now: Date) => Promise<boolean>;
  deleteSession: (tokenHash: string) => Promise<void>;
};

type AuthDatabase = Pick<DatabaseClient, 'user' | 'session'>;
const publicUserFields = { id: true, displayName: true, role: true } as const;

// Prisma queries stay behind this feature adapter; request tests use a fake store.
export function createAuthStore(database: AuthDatabase): AuthStore {
  return {
    findUser: (email) =>
      database.user.findUnique({
        where: { email },
        select: { ...publicUserFields, passwordHash: true },
      }),

    createSession: async (session) => {
      await database.session.create({ data: session });
    },

    findSession: (tokenHash) =>
      database.session.findUnique({
        where: { tokenHash },
        select: {
          lastSeenAt: true,
          expiresAt: true,
          user: { select: publicUserFields },
        },
      }),

    touchSession: async (tokenHash, now) => {
      // Conditional update prevents reviving a session deleted by concurrent logout.
      const result = await database.session.updateMany({
        where: {
          tokenHash,
          expiresAt: { gt: now },
          lastSeenAt: { gt: new Date(now.getTime() - SESSION_IDLE_TIMEOUT_MS) },
        },
        data: { lastSeenAt: now },
      });

      return result.count === 1;
    },

    deleteSession: async (tokenHash) => {
      // Repeating logout is harmless, including for already-expired sessions.
      await database.session.deleteMany({ where: { tokenHash } });
    },
  };
}
