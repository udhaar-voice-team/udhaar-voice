"use client";

import {
  BookOpenCheck,
  Camera,
  Home,
  type LucideIcon,
  MessagesSquare,
  Network,
  PhoneCall,
  Settings,
  Sparkles,
  Store,
  Users,
  Ellipsis,
  Gem,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useShop } from "@/lib/api/hooks";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ProfileMenu } from "./profile-menu";
import { ThemeToggle } from "./theme-toggle";

type NavItem = { href: string; label: string; short?: string; icon: LucideIcon; exact?: boolean };

function useNavItems(): NavItem[] {
  const t = useT().nav;
  return [
    { href: "/app", label: t.home, icon: Home, exact: true },
    { href: "/app/customers", label: t.customers, icon: Users },
    { href: "/app/khata", label: t.khata, icon: Camera },
    { href: "/app/calls", label: t.calls, icon: PhoneCall },
    { href: "/app/ask", label: t.ask, short: t.askShort, icon: Sparkles },
    { href: "/app/report", label: t.report, short: t.reportShort, icon: BookOpenCheck },
    { href: "/app/graph", label: t.graph, short: t.graphShort, icon: Network },
    { href: "/app/settings", label: t.settings, icon: Settings },
    { href: "/app/plans", label: t.plans, icon: Gem },
  ];
}

const isActive = (pathname: string | null, item: NavItem) =>
  !!pathname && (item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`));

function Brand() {
  const t = useT();
  const shop = useShop();
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
        <MessagesSquare className="size-5" />
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="font-heading text-base font-bold">{t.common.appName}</span>
        <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
          <Store className="size-3 shrink-0" />
          <span className="truncate">{shop.data?.name ?? "…"}</span>
        </span>
      </span>
    </div>
  );
}

/** Sidebar links. Reads the URL, so it sits in its own Suspense boundary (see Cache Components docs). */
function SidebarLinks({ pathname }: { pathname: string | null }) {
  const items = useNavItems();
  return (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {items.map((item) => {
        const active = isActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
            )}
          >
            <item.icon className={cn("size-4", active && "text-primary")} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarLinksWithPath() {
  return <SidebarLinks pathname={usePathname()} />;
}

function MobileTabs({ pathname }: { pathname: string | null }) {
  const t = useT().nav;
  const items = useNavItems();
  const [moreOpen, setMoreOpen] = useState(false);
  const primary = [items[0], items[1]];
  const secondary = [items[3]];
  const rest = items.slice(4);
  const restActive = rest.some((i) => isActive(pathname, i));

  const tab = (item: NavItem) => {
    const active = isActive(pathname, item);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn("flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium", active ? "text-primary" : "text-muted-foreground")}
      >
        <item.icon className="size-5" />
        {item.short ?? item.label}
      </Link>
    );
  };

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <div className="mx-auto flex max-w-md items-end px-2">
        {primary.map(tab)}
        <Link href="/app/khata" className="-mt-5 flex flex-1 flex-col items-center gap-1 pb-2 text-[11px] font-medium text-foreground" aria-label={items[2].label}>
          <span className="grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background">
            <Camera className="size-6" />
          </span>
          {items[2].label}
        </Link>
        {secondary.map(tab)}
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetTrigger className={cn("flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium", restActive ? "text-primary" : "text-muted-foreground")}>
            <Ellipsis className="size-5" />
            {t.more}
          </SheetTrigger>
          <SheetContent side="bottom" className="pb-[max(1rem,env(safe-area-inset-bottom))]">
            <SheetHeader>
              <SheetTitle>{t.more}</SheetTitle>
            </SheetHeader>
            <div className="grid grid-cols-3 gap-2 px-4">
              {rest.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-xl border p-3 text-center text-xs font-medium",
                    isActive(pathname, item) ? "border-primary text-primary" : "text-foreground",
                  )}
                >
                  <item.icon className="size-5" />
                  {item.short ?? item.label}
                </Link>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}

function MobileTabsWithPath() {
  return <MobileTabs pathname={usePathname()} />;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useT();
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[256px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r bg-sidebar px-3 py-5 lg:flex">
        <div className="px-2">
          <Brand />
        </div>
        <Suspense fallback={<SidebarLinks pathname={null} />}>
          <SidebarLinksWithPath />
        </Suspense>
        <div className="mt-auto space-y-2">
          <Link href="/" className="block px-2 text-xs text-muted-foreground hover:text-foreground">
            {t.nav.website}
          </Link>
          <div className="flex items-center gap-1 border-t pt-3">
            <ProfileMenu full />
            <ThemeToggle />
          </div>
        </div>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b bg-background/95 px-4 py-2.5 backdrop-blur lg:hidden">
          <Brand />
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <ProfileMenu />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-28 sm:px-6 lg:px-8 lg:pt-8 lg:pb-12">{children}</main>
        <Suspense fallback={<MobileTabs pathname={null} />}>
          <MobileTabsWithPath />
        </Suspense>
      </div>
    </div>
  );
}
