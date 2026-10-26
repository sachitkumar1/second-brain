"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/app/actions";
import { buttonClass } from "../ui";

/** Form bound to a server action; shows a pending state and the action's message. */
export function ActionForm({
  action,
  submitLabel = "Save",
  children,
  className,
}: {
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
  submitLabel?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className={className}>
      {children}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={buttonClass.primary}>
          {pending ? "Saving…" : submitLabel}
        </button>
        {state?.message && (
          <span role="status" className={state.ok ? "text-sm text-green" : "text-sm text-red"}>
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}
