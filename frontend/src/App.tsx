import { useEffect, useState } from 'react';
import { ApiError } from './api/api-client';
import { authApi } from './api/auth-api';
import type { CurrentUser } from './api/auth-contract';
import { TradeWorkspace } from './trades/TradeWorkspace';
import { LoginForm } from './auth/LoginForm';

type SessionState =
  | { status: 'checking' }
  | { status: 'signed-in'; user: CurrentUser }
  | { status: 'signed-out' }
  | { status: 'error' };

function App() {
  const [session, setSession] = useState<SessionState>({ status: 'checking' });
  const [sessionCheckAttempt, setSessionCheckAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function restoreSession() {
      try {
        const { user } = await authApi.me(controller.signal);
        if (!controller.signal.aborted) setSession({ status: 'signed-in', user });
      } catch (error) {
        if (controller.signal.aborted) return;

        if (error instanceof ApiError && error.status === 401) {
          setSession({ status: 'signed-out' });
        } else {
          setSession({ status: 'error' });
        }
      }
    }

    void restoreSession();

    // Cancel old checks and ignore late results, including Strict Mode's first check.
    return () => controller.abort();
  }, [sessionCheckAttempt]);

  function retrySessionCheck() {
    setSession({ status: 'checking' });
    setSessionCheckAttempt((attempt) => attempt + 1);
  }

  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-6 sm:px-6 sm:py-10">
      <div className={`w-full ${session.status === 'signed-in' ? 'max-w-7xl' : 'max-w-sm'}`}>
        <header className="mb-7 flex items-center gap-3">
          <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white">
            TB
          </span>
          <div>
            <p className="text-base font-semibold tracking-tight text-slate-950">Trade Blotter</p>
            <p className="text-xs text-slate-500">Equities workspace</p>
          </div>
        </header>

        <div className={session.status === 'signed-in' ? '' : 'rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-8'}>
          {session.status === 'checking' && (
            <p role="status" className="text-sm text-slate-600">Checking your session…</p>
          )}

          {session.status === 'error' && (
            <section aria-labelledby="session-error-title">
              <h1 id="session-error-title" className="text-xl font-semibold text-slate-950">
                Unable to load your account
              </h1>
              <p role="alert" className="mt-3 text-sm text-slate-600">
                Please try again in a moment.
              </p>
              <button
                type="button"
                onClick={retrySessionCheck}
                className="mt-5 w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
              >
                Try again
              </button>
            </section>
          )}

          {session.status === 'signed-in' && (
            <TradeWorkspace
              key={session.user.id}
              user={session.user}
              onSignedOut={() => setSession({ status: 'signed-out' })}
            />
          )}

          {session.status === 'signed-out' && (
            <LoginForm onAuthenticated={(user) => setSession({ status: 'signed-in', user })} />
          )}
        </div>
      </div>
    </main>
  );
}

export default App;
