/**
 * Every shop is in India, and the rules read local dates and hours (calling hours, "today").
 * Servers run in UTC, so the server process uses India's time zone. Import this before anything else.
 */
export const SHOP_TIME_ZONE = "Asia/Kolkata";
process.env.TZ = SHOP_TIME_ZONE;
