"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { buttonClass } from "../ui";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Subscribes this browser/phone to push notifications (on iPhone: add to Home Screen first). */
const noop = () => () => {};
const supportSnapshot = () =>
  !("serviceWorker" in navigator) || !("PushManager" in window) ? "unsupported" : Notification.permission === "denied" ? "denied" : "ok";

export function PushSetup({ publicKey }: { publicKey: string | null }) {
  const support = useSyncExternalStore(noop, supportSnapshot, () => "ok");
  const [subState, setState] = useState<"off" | "on" | "busy" | "denied">("off");
  const state = support === "ok" ? subState : support;

  useEffect(() => {
    if (support !== "ok") return;
    navigator.serviceWorker.getRegistration("/sw.js").then(async (reg) => {
      if (reg && (await reg.pushManager.getSubscription())) setState("on");
    });
  }, [support]);

  if (!publicKey) return <p className="text-sm text-muted">Push needs VAPID keys on the server (see SETUP.md). Email notifications work without it.</p>;
  if (state === "unsupported") return <p className="text-sm text-muted">This browser doesn&apos;t support push. On iPhone, open the dashboard in Safari → Share → Add to Home Screen, then enable it from there.</p>;
  if (state === "denied") return <p className="text-sm text-amber">Notifications are blocked for this site in your browser settings.</p>;

  const enable = async () => {
    setState("busy");
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "denied" : "off");
        return;
      }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      setState("on");
    } catch {
      setState("off");
    }
  };
  const disable = async () => {
    setState("busy");
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch(`/api/push?endpoint=${encodeURIComponent(sub.endpoint)}`, { method: "DELETE" });
      await sub.unsubscribe();
    }
    setState("off");
  };

  return state === "on" ? (
    <div className="flex items-center gap-3">
      <span className="text-sm text-green">This device gets push notifications.</span>
      <button className={buttonClass.secondary} onClick={disable}>
        Turn off on this device
      </button>
    </div>
  ) : (
    <button className={buttonClass.secondary} onClick={enable} disabled={state === "busy"}>
      {state === "busy" ? "Enabling…" : "Enable push on this device"}
    </button>
  );
}
