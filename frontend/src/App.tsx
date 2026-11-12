import { useState } from 'react';
import type { CurrentUser } from './api/auth-contract';
import { AccountPanel } from './auth/AccountPanel';
import { LoginForm } from './auth/LoginForm';

function App() {
  const [user, setUser] = useState<CurrentUser | null>(null);

  return (
    <main className="flex min-h-svh items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm">
        <header className="mb-7 flex items-center gap-3">
          <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white">
            TB
          </span>
          <div>
            <p className="text-base font-semibold tracking-tight text-slate-950">Trade Blotter</p>
            <p className="text-xs text-slate-500">Equities workspace</p>
          </div>
        </header>

        <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-8">
          {user ? (
            <AccountPanel user={user} onSignedOut={() => setUser(null)} />
          ) : (
            <LoginForm onAuthenticated={setUser} />
          )}
        </div>
      </div>
    </main>
  );
}

export default App;
