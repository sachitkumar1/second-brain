"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/app/actions";
import { buttonClass } from "./ui";

/** A button that runs a server action and shows its result inline. */
export function ActionButton({
  action,
  children,
  variant = "secondary",
  confirm,
}: {
  action: () => Promise<ActionResult>;
  children: React.ReactNode;
  variant?: keyof typeof buttonClass;
  confirm?: string;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending}
        className={buttonClass[variant]}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => setResult(await action()));
        }}
      >
        {pending ? "Working…" : children}
      </button>
      {result?.message && (
        <span role="status" className={result.ok ? "text-xs text-green" : "text-xs text-red"}>
          {result.message}
        </span>
      )}
    </span>
  );
}
