import type { UdhaarApi } from "./contract";
import { httpApi } from "./http";

/** The one place that decides which backend the app talks to: our API routes on Supabase. */
export const api: UdhaarApi = httpApi;
