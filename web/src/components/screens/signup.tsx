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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api } from "@/lib/api";
import type { SignUpInput } from "@/lib/api/contract";
import { useApiMutation } from "@/lib/api/hooks";
import type { Language } from "@/lib/domain/types";
import { useT } from "@/lib/i18n";

const LANGUAGES: Language[] = ["bn", "hi", "en"];

export function SignupScreen() {
  const t = useT().auth;
  const router = useRouter();
  const queryClient = useQueryClient();
  const [shopName, setShopName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [language, setLanguage] = useState<Language>("bn");
  const [error, setError] = useState<string | null>(null);
  const signUp = useApiMutation((input: SignUpInput) => api.signUp(input));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const session = await signUp.mutateAsync({ shopName, ownerName, phone, email, password, language });
      queryClient.setQueryData(["session"], session);
      toast.success(t.signup.created);
      router.push("/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create your khata.");
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <Card>
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl">{t.signup.title}</CardTitle>
          <CardDescription>{t.signup.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="shop">{t.signup.shopName}</Label>
              <Input id="shop" value={shopName} onChange={(e) => setShopName(e.target.value)} placeholder={t.signup.shopNamePlaceholder} aria-invalid={!!error} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="owner">{t.signup.ownerName}</Label>
              <Input id="owner" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder={t.signup.ownerNamePlaceholder} aria-invalid={!!error} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="signup-phone">{t.signup.phone}</Label>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-muted-foreground">+91</span>
                <Input id="signup-phone" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} aria-invalid={!!error} />
              </div>
              <p className="text-xs text-muted-foreground">{t.signup.phoneHint}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="signup-email">{t.signup.email}</Label>
              <Input
                id="signup-email"
                type="email"
                autoComplete="email"
                required
                placeholder={t.signup.emailPlaceholder}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={!!error}
              />
              <p className="text-xs text-muted-foreground">{t.signup.emailHint}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="signup-password">{t.signup.password}</Label>
              <Input id="signup-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!error} />
            </div>
            <div className="space-y-2">
              <Label>{t.signup.language}</Label>
              <ToggleGroup type="single" variant="outline" value={language} onValueChange={(v) => v && setLanguage(v as Language)}>
                {LANGUAGES.map((l) => (
                  <ToggleGroupItem key={l} value={l}>
                    {t.signup.languageOptions[l]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" size="lg" className="w-full" disabled={signUp.isPending}>
              {t.signup.submit}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            {t.signup.hasAccount}{" "}
            <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
              {t.signup.signInLink}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
