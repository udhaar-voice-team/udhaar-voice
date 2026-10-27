import "@/lib/server/timezone";
import type { UdhaarApi } from "@/lib/api/contract";
import { NotSignedIn, serverApi } from "@/lib/server/api";
import { userClient } from "@/lib/server/supabase";

/**
 * One endpoint per contract method: POST /api/udhaar/<method> with `{ args: [...] }`, or form data
 * for `transcribe`. Answers `{ data }`, or `{ error }` with a message the shopkeeper can read.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/udhaar/[method]">) {
  const { method } = await ctx.params;
  if (!Object.hasOwn(serverApi, method)) return Response.json({ error: "Unknown method" }, { status: 404 });
  const name = method as keyof UdhaarApi;

  let args: unknown[];
  try {
    if (name === "transcribe") {
      const form = await request.formData();
      args = [form.get("audio")];
    } else {
      const body = (await request.json()) as { args?: unknown };
      args = Array.isArray(body.args) ? body.args : [];
    }
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }

  try {
    // Methods outside PUBLIC_METHODS check the session themselves and throw NotSignedIn.
    const sb = await userClient();
    const handler = serverApi[name] as (c: { sb: typeof sb; now: Date }, ...a: unknown[]) => Promise<unknown>;
    const data = await handler({ sb, now: new Date() }, ...args);
    return Response.json({ data: data ?? null });
  } catch (err) {
    if (err instanceof NotSignedIn) return Response.json({ error: err.message }, { status: 401 });
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[api] ${name}:`, message);
    return Response.json({ error: message }, { status: 400 });
  }
}
