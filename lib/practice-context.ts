import { AsyncLocalStorage } from "node:async_hooks";

/**
 * "Is the request being handled right now a practice request?" – answered anywhere in the code, without passing anything around.
 * The Worker entry (admin-entry.ts) wraps a practising browser's whole request in runInPractice(), so every database query, email,
 * picture delete and background job started by that request knows it is practice. (Background work started by the request keeps the
 * answer, which is what stops a practice order from sending a real email a moment after the page has answered.)
 * SANDBOX=1 makes a whole server practise (used by the automated tests).
 */
const store = new AsyncLocalStorage<{ practice: true }>();

export const runInPractice = <T>(work: () => T): T => store.run({ practice: true }, work);

export const isPracticeRequest = (): boolean => process.env.SANDBOX === "1" || store.getStore()?.practice === true;
