"use client";

import Script from "next/script";
import { useEffect, useState } from "react";

const KEY = "na-cookie-choice";

/** Browser storage can be blocked (private windows, strict settings): reading or writing must never break the page. */
function readChoice(): "accepted" | "essential" | null {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === "accepted" || value === "essential" ? value : null;
  } catch {
    return null;
  }
}
function saveChoice(value: "accepted" | "essential") {
  try {
    window.localStorage.setItem(KEY, value);
  } catch {
    // the choice still applies for this page view
  }
}

/** The analytics IDs are typed by the owner and end up inside a script – only plain ID characters are ever allowed through. */
const plainId = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, "");

/** A value written as a quoted piece of script text: the characters that could end the script tag or the line become \uXXXX escapes. */
const scriptValue = (value: string) => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);

export function AnalyticsConsent({
  metaPixelId,
  gaMeasurementId,
  nonce,
}: {
  metaPixelId: string;
  gaMeasurementId: string;
  nonce: string;
}) {
  const metaId = plainId(metaPixelId);
  const gaId = plainId(gaMeasurementId);
  const enabled = Boolean(metaId || gaId);
  const [choice, setChoice] = useState<"accepted" | "essential" | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setChoice(readChoice()), 0);
    return () => clearTimeout(timer);
  }, []);
  if (!enabled) return null;
  function choose(value: "accepted" | "essential") {
    saveChoice(value);
    setChoice(value);
  }
  return <>
    {choice === "accepted" && gaId && <><Script src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`} strategy="lazyOnload" /><Script id="muse-google-analytics" strategy="lazyOnload" nonce={nonce}>{`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config',${scriptValue(gaId)},{anonymize_ip:true});`}</Script></>}
    {choice === "accepted" && metaId && <Script id="na-meta-pixel" strategy="lazyOnload" nonce={nonce}>{`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init',${scriptValue(metaId)});fbq('track','PageView');`}</Script>}
    {choice === null && <aside className="cookie-banner"><div><strong>A considered digital experience</strong><p>With your permission, optional analytics help us understand visits and improve advertising. Essential store functions always remain active.</p></div><button onClick={() => choose("essential")}>Essential only</button><button className="button-dark" onClick={() => choose("accepted")}>Allow analytics</button></aside>}
  </>;
}
