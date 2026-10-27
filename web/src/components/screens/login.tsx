"use client";

import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import type { SignInInput } from "@/lib/api/contract";
import { useApiMutation } from "@/lib/api/hooks";
import { DEMO_EMAIL, DEMO_PASSWORD, DEMO_PHONE } from "@/lib/demo/account";
import { useT } from "@/lib/i18n";

export function LoginScreen() {
  const t = useT().auth;
  const router = useRouter();
  const queryClient = useQueryClient();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const signIn = useApiMutation((input: SignInInput) => api.signIn(input));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const session = await signIn.mutateAsync({ identifier, password });
      // Prime the session cache so AuthGuard sees the signed-in state on the next render,
      // instead of the stale `null` the invalidation would leave in place until the refetch lands.
      queryClient.setQueryData(["session"], session);
      toast.success(t.signedIn(session.user.name));
      router.push("/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl">{t.login.title}</CardTitle>
          <CardDescription>{t.login.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="identifier">{t.login.identifier}</Label>
              <Input
                id="identifier"
                autoComplete="username"
                placeholder={t.login.identifierPlaceholder}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                aria-invalid={!!error}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t.login.password}</Label>
              <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!error} />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" size="lg" className="w-full" disabled={signIn.isPending}>
              {t.login.submit}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {t.login.noAccount}{" "}
            <Link href="/signup" className="font-medium text-primary underline-offset-4 hover:underline">
              {t.login.signUpLink}
            </Link>
          </p>
          <p className="mt-6 rounded-md border bg-muted/40 px-3 py-2 text-center font-mono text-xs text-muted-foreground">
            {t.login.hint(DEMO_PHONE, DEMO_EMAIL, DEMO_PASSWORD)}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
