"use client";

import { Check, Copy, Download, IndianRupee } from "lucide-react";
import { useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatINR, upiLink } from "@/lib/domain/rules";
import { LANGUAGES, type Language } from "@/lib/domain/types";
import { dictionaryFor } from "@/lib/i18n";

const UPI_ID = /^[A-Za-z0-9._-]{2,}@[A-Za-z0-9.-]{2,}$/;

/**
 * The customer's side of a WhatsApp reminder: one button that opens their UPI app, and the QR code
 * to download and scan from the gallery. No amount is fixed, so they can pay part of their dues.
 */
export function PayScreen() {
  const q = useSearchParams();
  const language = (LANGUAGES as readonly string[]).includes(q.get("l") ?? "") ? (q.get("l") as Language) : "en";
  const t = dictionaryFor(language).pay;
  const upiId = q.get("pa") ?? "";
  const shop = (q.get("pn") ?? "").slice(0, 60);
  const due = Math.round(Number(q.get("due")));
  const valid = UPI_ID.test(upiId) && shop !== "";
  const link = valid ? upiLink({ upiId, payeeName: shop }) : "";
  const [qr, setQr] = useState<{ link: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!link) return;
    let cancelled = false;
    QRCode.toDataURL(link, { width: 512, margin: 2, errorCorrectionLevel: "M" }).then((url) => {
      if (!cancelled) setQr({ link, url });
    });
    return () => {
      cancelled = true;
    };
  }, [link]);

  if (!valid) return <p className="max-w-sm text-center text-sm text-muted-foreground">{t.invalid}</p>;
  const image = qr?.link === link ? qr.url : null;

  return (
    <Card lang={language} className="w-full max-w-sm">
      <CardContent className="flex flex-col items-center gap-4 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
          <IndianRupee className="size-6" />
        </span>
        <div className="space-y-1">
          <h1 className="text-xl font-bold">{t.title(shop)}</h1>
          {due > 0 ? <p className="font-heading text-2xl font-bold">{t.due(formatINR(due))}</p> : null}
          <p className="text-sm text-muted-foreground">{t.part}</p>
        </div>
        <Button asChild size="lg" className="h-12 w-full text-base">
          <a href={link}>{t.button}</a>
        </Button>
        {image ? (
          // A data URL made here; next/image can't optimise it.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt={t.title(shop)} className="aspect-square w-full max-w-60 rounded-lg bg-white p-2" />
        ) : (
          <div className="aspect-square w-full max-w-60 animate-pulse rounded-lg bg-muted" />
        )}
        <p className="text-xs text-muted-foreground">{t.scan}</p>
        {image ? (
          <Button asChild variant="outline" className="w-full">
            <a href={image} download={`upi-${upiId}.png`}>
              <Download /> {t.download}
            </a>
          </Button>
        ) : null}
        <div className="flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
          <span className="min-w-0 truncate">
            <span className="text-muted-foreground">{t.upiId}: </span>
            <span className="font-medium">{upiId}</span>
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void navigator.clipboard.writeText(upiId).then(
                () => setCopied(true),
                () => undefined,
              )
            }
          >
            {copied ? <Check /> : <Copy />} {copied ? t.copied : t.copy}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
