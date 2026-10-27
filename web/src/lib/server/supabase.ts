import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { env } from "./env";

/**
 * As the signed-in shopkeeper: the session comes from cookies, and every query is limited to their
 * shop by the database's access rules.
 */
export async function userClient(): Promise<SupabaseClient> {
  const store = await cookies();
  return createServerClient(env.supabaseUrl(), env.supabaseAnonKey(), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        for (const { name, value, options } of list) store.set(name, value, options);
      },
    },
  });
}

let admin: SupabaseClient | undefined;

/** Bypasses the access rules. Only for work no single shopkeeper owns: sign-up, shared call lines, the demo page. */
export function adminClient(): SupabaseClient {
  admin ??= createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

type Result<T> = { data: T | null; error: { message: string; code?: string } | null };

/** The query's data, or a readable error. Database exceptions are already worded for the shopkeeper. */
export function check<T>(result: Result<T>): T {
  if (result.error) throw new Error(friendly(result.error));
  if (result.data === null) throw new Error("Not found");
  return result.data;
}

/** Like `check`, for queries where finding nothing is fine (`maybeSingle`, writes without `select`). */
export function maybe<T>(result: Result<T>): T | null {
  if (result.error) throw new Error(friendly(result.error));
  return result.data;
}

function friendly(error: { message: string; code?: string }): string {
  if (error.code === "23505") return "That already exists.";
  if (error.code === "23514") return "Some details aren't valid. Check them and try again.";
  return error.message;
}
