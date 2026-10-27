"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/app/bits";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import type { ProfileInput, Session } from "@/lib/api/contract";
import { useApiMutation, useSession } from "@/lib/api/hooks";
import { formatINR, upiLink } from "@/lib/domain/rules";
import { useT } from "@/lib/i18n";

const EXAMPLE_DUE = 250;

export function ProfileScreen() {
  const t = useT().profile;
  const q = useSession();
  if (q.isPending) return <LoadingBlock />;
  if (q.isError || !q.data) return <ErrorBlock onRetry={() => q.refetch()} />;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title={t.title} description={t.description} />
      <ProfileForm key={JSON.stringify(q.data)} session={q.data} />
    </div>
  );
}

/** Shows a stored +91 number as the 10 digits people type. */
const localPhone = (e164: string) => e164.replace(/^\+91/, "");

function ProfileForm({ session: { user, shop } }: { session: Session }) {
  const { profile: t, customers } = useT();
  const save = useApiMutation(api.updateProfile);
  const [draft, setDraft] = useState<ProfileInput>({
    name: user.name,
    phone: localPhone(user.phone),
    email: user.email ?? "",
    shopName: shop.name,
    upiId: shop.upiId,
  });
  const set = (key: keyof ProfileInput, value: string) => setDraft((d) => ({ ...d, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await save.mutateAsync(draft);
      toast.success(t.saved);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const field = (key: keyof ProfileInput, label: string, hint?: string, props?: React.ComponentProps<typeof Input>) => (
    <div className="space-y-1.5">
      <Label htmlFor={`profile-${key}`}>{label}</Label>
      <Input id={`profile-${key}`} value={draft[key] ?? ""} onChange={(e) => set(key, e.target.value)} className="h-11 sm:h-10" {...props} />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );

  const example = customers.detail.upiMessage(
    draft.shopName || shop.name,
    formatINR(EXAMPLE_DUE),
    upiLink({ upiId: draft.upiId, payeeName: draft.shopName, amount: EXAMPLE_DUE, note: "Khata dues" }),
  );

  return (
    <form onSubmit={submit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t.you.title}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {field("name", t.you.name, undefined, { autoComplete: "name", required: true })}
          {field("phone", t.you.phone, t.you.phoneHint, { inputMode: "tel", autoComplete: "tel-national", required: true })}
          {field("email", t.you.email, t.you.emailHint, { type: "email", autoComplete: "email", required: true })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.shop.title}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {field("shopName", t.shop.name, undefined, { autoComplete: "organization", required: true })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.payments.title}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {field("upiId", t.payments.upi, t.payments.upiHint, { autoCapitalize: "none", spellCheck: false })}
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t.payments.preview}</p>
            <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs leading-relaxed break-all text-muted-foreground">{example}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.account.title}</CardTitle>
          <CardDescription>{t.account.password}</CardDescription>
        </CardHeader>
      </Card>

      <div className="sticky bottom-20 z-10 flex justify-end lg:static">
        <Button type="submit" size="lg" className="w-full shadow-lg sm:w-auto lg:shadow-none" disabled={save.isPending}>
          {t.save}
        </Button>
      </div>
    </form>
  );
}
