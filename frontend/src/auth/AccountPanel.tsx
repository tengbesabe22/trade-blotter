import { useState } from 'react';
import { ApiError } from '../api/api-client';
import { authApi } from '../api/auth-api';
import type { CurrentUser } from '../api/auth-contract';

type AccountPanelProps = {
  user: CurrentUser;
  onSignedOut: () => void;
};

export function AccountPanel({ user, onSignedOut }: AccountPanelProps) {
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSignOut() {
    if (isSigningOut) return;

    setIsSigningOut(true);
    setErrorMessage(null);

    try {
      await authApi.logout();
      // Keep the account visible until the server confirms the session was revoked.
      onSignedOut();
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'Unable to sign out. Please try again.');
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <section aria-labelledby="account-title" aria-busy={isSigningOut} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:px-6">
      <h2 id="account-title" className="sr-only">Your account</h2>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-semibold text-slate-900">{user.displayName}</p>
          <p className="mt-1 text-sm text-slate-600">
            {user.role === 'TRADER' ? 'Trader' : 'Read-only reviewer'}
          </p>
        </div>

        <button
          type="button"
          onClick={handleSignOut}
          disabled={isSigningOut}
          className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-wait disabled:opacity-60"
        >
          {isSigningOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>

      {errorMessage && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-800">
          {errorMessage}
        </p>
      )}
    </section>
  );
}
