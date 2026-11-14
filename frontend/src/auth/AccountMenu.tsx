import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/api-client';
import { authApi } from '../api/auth-api';
import type { CurrentUser } from '../api/auth-contract';

type AccountMenuProps = {
  user: CurrentUser;
  onSignedOut: () => void;
};

export function AccountMenu({ user, onSignedOut }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    function closeOutside(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    }

    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

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
    <div ref={container} className="relative ml-auto">
      <button ref={trigger} type="button" aria-label={'Account for ' + user.displayName}
        aria-expanded={open} aria-controls="account-dropdown" title="Your account"
        onClick={() => setOpen((current) => !current)}
        className="flex size-11 items-center justify-center rounded-full border border-slate-300 bg-white font-semibold text-slate-800 shadow-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
        <span aria-hidden="true">{user.displayName.charAt(0).toUpperCase()}</span>
      </button>
      {open && (
        <section id="account-dropdown" aria-label="Your account" aria-busy={isSigningOut}
          className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
          <p className="break-words font-semibold text-slate-900">{user.displayName}</p>
          <p className="mt-1 text-sm text-slate-600">
            {user.role === 'TRADER' ? 'Trader' : 'Read-only reviewer'}
          </p>
          <button type="button" onClick={handleSignOut} disabled={isSigningOut}
            className="mt-3 min-h-11 w-full rounded-lg border border-slate-300 px-4 py-2 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-700 disabled:cursor-wait disabled:opacity-60">
            {isSigningOut ? 'Signing out…' : 'Sign out'}
          </button>
          {errorMessage && (
            <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{errorMessage}</p>
          )}
        </section>
      )}
    </div>
  );
}
