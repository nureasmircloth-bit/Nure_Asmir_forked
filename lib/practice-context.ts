/**
 * "Is this the training lab?" – answered anywhere in the code. The training site (training.nureasmir.com) is its own Worker that is
 * deployed with SANDBOX=1 and with a database connection to the practice tables only, so the answer is the same for every request it
 * serves, and the real admin and the real shop (which never set SANDBOX) can never be in practice mode.
 */
/** True on the training Worker (SANDBOX=1) and on the test server that imitates it. */
export const isPracticeRequest = (): boolean => process.env.SANDBOX === "1";
