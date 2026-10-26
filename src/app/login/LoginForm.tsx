"use client";

import { useActionState } from "react";
import { login } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <label className="block">
        <span className="text-sm font-medium text-ink-2">Password</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          autoFocus
          required
          className="mt-1.5 block w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-[15px] text-ink outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
        />
      </label>
      {state?.error && (
        <p role="alert" className="text-sm text-red">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-navy px-4 py-2.5 text-[15px] font-semibold text-on-navy transition hover:bg-navy-hover disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
