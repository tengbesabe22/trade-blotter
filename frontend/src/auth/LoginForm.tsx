import { useState, type SubmitEvent } from 'react';
import { ApiError } from '../api/api-client';
import { authApi } from '../api/auth/auth-api';
import type { CurrentUser } from '../api/contracts/auth/auth-contract';

type LoginFormProps = {
  onAuthenticated: (user: CurrentUser) => void;
};

const inputClassName = 'mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 disabled:bg-slate-100';

export function LoginForm({ onAuthenticated }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const { user } = await authApi.login({ email, password });
      onAuthenticated(user);
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : 'Unable to connect. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} aria-labelledby="login-title" aria-busy={isSubmitting}>
      <h1 id="login-title" className="text-2xl font-semibold tracking-tight text-slate-950">
        Sign in
      </h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        Use your account to access the trade blotter.
      </p>

      <div className="mt-7 space-y-5">
        <div>
          <label htmlFor="login-email" className="block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="login-email"
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={isSubmitting}
            className={inputClassName}
          />
        </div>

        <div>
          <label htmlFor="login-password" className="block text-sm font-medium text-slate-700">
            Password
          </label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={isSubmitting}
            className={inputClassName}
          />
        </div>

        {errorMessage && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-800">
            {errorMessage}
          </p>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-wait disabled:opacity-60"
        >
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
    </form>
  );
}
