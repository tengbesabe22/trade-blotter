import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CurrentUser } from '../api/contracts/auth/auth-contract';
import { CreateTradeForm } from './CreateTradeForm';
import { TradesPage } from './TradesPage';

type TradeWorkspaceProps = {
  user: CurrentUser;
  onSignedOut: () => void;
};

export function TradeWorkspace({ user, onSignedOut }: TradeWorkspaceProps) {
  // This cache belongs to one signed-in workspace, never to the next login.
  const [createSubmissionLocked, setCreateSubmissionLocked] = useState(false);
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <TradesPage user={user} onSessionExpired={onSignedOut}
        createSubmissionLocked={createSubmissionLocked}
        tradePanel={user.role === 'TRADER' && (
          <CreateTradeForm
            onSessionExpired={onSignedOut}
            onSubmissionLockChange={setCreateSubmissionLocked}
            onCreated={() => { void queryClient.invalidateQueries({ queryKey: ['trades'] }); }}
          />
        )}
      />
    </QueryClientProvider>
  );
}
