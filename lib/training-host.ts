/** Where the training lab lives, and the small pieces of state it shares between its pages. */

/** The training site's address (the real admin links to it). Set NEXT_PUBLIC_TRAINING_URL to change it. */
export const TRAINING_URL = (process.env.NEXT_PUBLIC_TRAINING_URL || "https://training.nureasmir.com").replace(/\/+$/, "");

/** Set when a trainee has pressed "Start my lab" (so the lab never opens half-ready). Lasts one working day. */
export const LAB_COOKIE = "na_lab";
export const LAB_COOKIE_HOURS = 12;

/** Pages of the training site that do not need the lab to have been started yet. */
export const TRAINING_ENTRY_PATHS = ["/admin/training-login", "/admin/training-start"];
