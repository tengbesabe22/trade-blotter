import type { DatabaseClient } from '@trade-blotter/database';

type LoginUser = {
  id: string;
  displayName: string;
  role: 'TRADER' | 'READ_ONLY';
  passwordHash: string;
};

export type LoginStore = {
  findUser: (email: string) => Promise<LoginUser | null>;
  createSession: (session: { userId: string; tokenHash: string; expiresAt: Date }) => Promise<void>;
};

// Depend only on the models this feature uses; transaction clients also fit.
type LoginDatabase = Pick<DatabaseClient, 'user' | 'session'>;

// Keep Prisma queries here so startup and HTTP handling stay easy to read.
export function createLoginStore(database: LoginDatabase): LoginStore {
  return {
    findUser: (email) =>
      database.user.findUnique({
        where: { email },
        select: { id: true, displayName: true, role: true, passwordHash: true },
      }),

    createSession: async (session) => {
      await database.session.create({ data: session });
    },
  };
}
