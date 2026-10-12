"use client";

import { useEffect, useState } from "react";
import { firebaseConfig, firebaseVapidKey } from "@/lib/firebase/config";
import { SW_URL } from "@/lib/sw-url";

const TOKEN_KEY = "na-admin-push-token";

type State = "unsupported" | "off" | "on" | "blocked" | "busy";

/** "Order alerts" switch in the admin sidebar: registers this browser with Firebase Cloud Messaging
 * and stores the device token so new orders / payment proofs can be pushed to it. */
import { Icon } from "../_ui/icons";

export function PushToggle({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<State>("busy");
  const [note, setNote] = useState("");

  useEffect(() => {
    // Browser capability + saved token can only be read after mount.
    const supported = "Notification" in window && "serviceWorker" in navigator;
    if (!supported) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("blocked");
      return;
    }
    const saved = window.localStorage.getItem(TOKEN_KEY);
    setState(saved && Notification.permission === "granted" ? "on" : "off");
  }, []);

  async function enable() {
    setState("busy");
    setNote("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const [{ initializeApp, getApps }, { getMessaging, getToken }] = await Promise.all([import("firebase/app"), import("firebase/messaging")]);
      const app = getApps()[0] ?? initializeApp(firebaseConfig);
      const registration = await navigator.serviceWorker.register(SW_URL);
      await navigator.serviceWorker.ready;
      const token = await getToken(getMessaging(app), {
        serviceWorkerRegistration: registration,
        ...(firebaseVapidKey ? { vapidKey: firebaseVapidKey } : {}),
      });
      if (!token) throw new Error("No device token was issued.");
      const response = await fetch("/api/admin/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) throw new Error("The server rejected the registration.");
      const result = (await response.json()) as { ready?: boolean };
      window.localStorage.setItem(TOKEN_KEY, token);
      setNote(result.ready ? "" : "Registered — alerts start once the server key is added.");
      setState("on");
    } catch (error) {
      console.error("Enabling order alerts failed", error);
      setNote("Could not enable alerts on this browser.");
      setState("off");
    }
  }

  async function disable() {
    setState("busy");
    const token = window.localStorage.getItem(TOKEN_KEY);
    try {
      if (token) {
        const response = await fetch("/api/admin/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
        if (!response.ok) throw new Error(`Unregister responded ${response.status}`);
      }
      window.localStorage.removeItem(TOKEN_KEY);
      setNote("");
      setState("off");
    } catch (error) {
      // Keep the local token and stay "on": the server still has this device registered.
      console.error("Disabling order alerts failed", error);
      setNote("Couldn't turn alerts off — please try again.");
      setState("on");
    }
  }

  if (state === "unsupported") return null;

  if (compact) {
    return (
      <button
        type="button"
        className={`a-icon-btn adm-push-compact ${state === "on" ? "is-active" : ""}`}
        disabled={state === "busy" || state === "blocked"}
        onClick={state === "on" ? disable : enable}
        title={
          note ||
          (state === "on"
            ? "Order alerts: on (click to disable)"
            : state === "blocked"
            ? "Alerts are blocked in this browser"
            : "Turn on order alerts")
        }
        aria-label={
          state === "on"
            ? "Turn off order alerts"
            : state === "blocked"
            ? "Order alerts blocked in browser"
            : "Turn on order alerts"
        }
      >
        {state === "busy" ? (
          <span className="spinner" aria-hidden="true" />
        ) : (
          <>
            <Icon name="bell" size={17} />
            {state === "on" && <span className="adm-push-dot" aria-hidden="true" />}
          </>
        )}
      </button>
    );
  }

  return (
    <div className="admin-push">
      <button
        type="button"
        className={`a-btn${state === "on" ? "" : " a-btn-primary"}`}
        disabled={state === "busy" || state === "blocked"}
        onClick={state === "on" ? disable : enable}
        title="Get a pop-up on this computer the moment a new order, payment or refund request arrives"
      >
        {state === "busy" ? <span className="spinner" aria-hidden="true" /> : null}
        {state === "on" ? "Order alerts: on" : state === "blocked" ? "Alerts are blocked in this browser" : "Turn on order alerts"}
      </button>
      {state === "blocked" && <small className="a-help">Click the padlock next to the address bar and allow notifications, then reload.</small>}
      {note && <small className="a-help">{note}</small>}
    </div>
  );
}
