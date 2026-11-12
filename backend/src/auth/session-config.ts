// Change session timing here. Cookie Max-Age uses seconds; dates use milliseconds.
export const SESSION_MAX_DURATION_HOURS = 8;
export const SESSION_MAX_AGE_SECONDS = SESSION_MAX_DURATION_HOURS * 60 * 60;
export const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1000;

export const SESSION_IDLE_TIMEOUT_MINUTES = 5;
export const SESSION_IDLE_TIMEOUT_MS = SESSION_IDLE_TIMEOUT_MINUTES * 60 * 1000;
export const SESSION_COOKIE_NAME = 'blotter_session';
