"use client";

import { Check, PhoneCall } from "lucide-react";
import { toast } from "sonner";

import { ErrorBlock, LoadingBlock, PageHeader, Stat } from "@/components/app/bits";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { attempt, useApiMutation, usePlan } from "@/lib/api/hooks";
import { CALL_PACK, CALLS_PER_CUSTOMER_PER_MONTH, formatINR, MIN_DUE_FOR_CALL, PLANS } from "@/lib/domain/rules";
import { PlanId } from "@/lib/domain/types";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** The plans, side by side like any subscription page, with what the shop has used. */
export function PlansScreen() {
  const t = useT().plans;
  const q = usePlan();
  const setPlan = useApiMutation(api.setPlan);
  const addPack = useApiMutation(api.addCallPack);
  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock onRetry={() => q.refetch()} />;
  const u = q.data;

  const features = (id: PlanId) => {
    const p = PLANS[id];
    return id === "free" ? t.features.free(p.photoReadsPerDay) : t.features[id](p.callsPerMonth, p.photoReadsPerDay);
  };
  const choose = async (id: PlanId) => {
    if (await attempt(setPlan.mutateAsync(id))) toast.success(t.switched(t.names[id]));
  };
  const pack = async () => {
    if (await attempt(addPack.mutateAsync())) toast.success(t.packAdded(CALL_PACK.calls));
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t.title} description={t.description} />
      <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">{t.pilot}</p>

      <div className="grid gap-4 md:grid-cols-3">
        {PlanId.options.map((id) => {
          const current = u.plan === id;
          const featured = id === "asha";
          return (
            <Card key={id} className={cn("flex flex-col", featured && "border-primary ring-1 ring-primary")}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>{t.names[id]}</CardTitle>
                  {current ? <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground">{t.current}</span> : null}
                </div>
                <CardDescription>
                  <span className="font-heading text-3xl font-bold text-foreground">{formatINR(PLANS[id].price)}</span>
                  {PLANS[id].price ? <span className="text-sm"> {t.perMonth}</span> : null}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1">
                <ul className="space-y-2 text-sm">
                  {features(id).map((f) => (
                    <li key={f} className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                      {f}
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                <Button className="w-full" size="lg" variant={featured ? "default" : "outline"} disabled={current || setPlan.isPending} onClick={() => choose(id)}>
                  {current ? t.current : t.choose}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t.usage.title}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <Stat label={t.usage.callsLabel} value={u.callsIncluded ? `${u.callsUsed}/${u.callsIncluded}` : "0"} hint={u.callsIncluded ? t.usage.calls(u.callsUsed, u.callsIncluded) : t.usage.noCalls} />
            <Stat label={t.usage.photosLabel} value={`${u.photoReadsToday}/${u.photoReadsPerDay}`} hint={t.usage.photos(u.photoReadsToday, u.photoReadsPerDay)} />
            {u.extraCalls ? <p className="col-span-2 text-sm text-muted-foreground">{t.usage.extra(u.extraCalls)}</p> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t.pack.title}</CardTitle>
            <CardDescription>{t.pack.body(CALL_PACK.calls, formatINR(CALL_PACK.price))}</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button variant="outline" size="lg" onClick={pack} disabled={addPack.isPending}>
              <PhoneCall /> {t.pack.add} · {formatINR(CALL_PACK.price)}
            </Button>
          </CardFooter>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t.how.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm">
            {t.how.steps(formatINR(MIN_DUE_FOR_CALL), CALLS_PER_CUSTOMER_PER_MONTH).map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
