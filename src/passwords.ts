/**
 * How short a password may be, in one place for both ends: the server refuses
 * anything shorter, and the screen where one is chosen will not send it.
 *
 * Long enough to be worth having. No rules about punctuation: they only
 * produce one capital at the front and one digit at the end.
 */
export const MIN_PASSWORD_LENGTH = 8;
