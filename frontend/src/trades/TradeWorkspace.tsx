import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CurrentUser } from '../api/auth-contract';
import { AccountPanel } from '../auth/AccountPanel';
import { TradesPage } from './TradesPage';

type TradeWorkspaceProps = {
  user: CurrentUser;
  onSignedOut: () => void;
};

export function TradeWorkspace({ user, onSignedOut }: TradeWorkspaceProps) {
  // This cache belongs to one signed-in workspace, never to the next login.
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <div className="space-y-6">
        <AccountPanel user={user} onSignedOut={onSignedOut} />
        <TradesPage onSessionExpired={onSignedOut} />
      </div>
    </QueryClientProvider>
  );
}
