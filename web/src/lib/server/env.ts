/** Server-only settings, read from web/.env.local locally and from the Vercel project when deployed. */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Add it to web/.env.local.`);
  return value;
}

export const env = {
  supabaseUrl: () => required("SUPABASE_URL"),
  supabaseAnonKey: () => required("SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  /** Calls that can be on the line at once, across every shop. Bolna trial accounts allow 2. */
  callLines: () => Number(process.env.BOLNA_CALL_LINES ?? 2),
};
