"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Cpu, ListTodo, Menu, MessageSquare, Radio } from "lucide-react";
import {
  Badge,
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@corely/ui";
import { useAuth } from "@/components/auth/auth-context";
import { OwnerMenu } from "@/components/auth/owner-menu";

const navigation = [
  { href: "/devices", label: "Devices", icon: Radio },
  { href: "/conversations", label: "Conversations", icon: MessageSquare },
  { href: "/todos", label: "Todos", icon: ListTodo },
];

function Brand() {
  return (
    <Link
      href="/todos"
      className="flex items-center gap-3 rounded-md focus-ring"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15">
        <Cpu aria-hidden="true" className="h-6 w-6" />
      </span>
      <span>
        <span className="block text-lg font-extrabold tracking-tight">
          OpenHuli
        </span>
        <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-success">
          Control Center
        </span>
      </span>
    </Link>
  );
}

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main navigation" className="space-y-1">
      {navigation.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            onClick={onNavigate}
            className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring ${
              active
                ? "bg-sidebar-primary font-semibold text-sidebar-primary-foreground"
                : "text-sidebar-foreground/75 hover:bg-white/10 hover:text-sidebar-foreground"
            }`}
          >
            <Icon aria-hidden="true" className="h-[18px] w-[18px] shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function Account() {
  const { user } = useAuth();
  const accountName = user?.name || user?.email || "Owner";
  return (
    <div className="space-y-3 rounded-lg bg-sidebar-accent p-3">
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white/15 text-sm font-semibold"
        >
          {accountName.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{accountName}</p>
          <p className="truncate text-xs text-sidebar-foreground/60">
            {user?.tenantName || "Your home"}
          </p>
        </div>
      </div>
      <OwnerMenu className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-sidebar-foreground/75 hover:bg-white/10 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring" />
    </div>
  );
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [navigationReady, setNavigationReady] = useState(false);
  // The server-rendered trigger must wait for its drawer event handlers.
  useEffect(() => setNavigationReady(true), []);
  const section = navigation.find(
    ({ href }) => pathname === href || pathname.startsWith(`${href}/`),
  );
  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[272px_minmax(0,1fr)]">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-card px-4 py-3 text-primary focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh flex-col bg-sidebar px-4 pb-6 pt-8 text-sidebar-foreground lg:flex">
        <div className="px-2">
          <Brand />
        </div>
        <div className="mt-10 min-h-0 flex-1 overflow-y-auto">
          <p className="mb-3 px-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/50">
            Your home
          </p>
          <Navigation />
        </div>
        <Account />
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex min-h-20 items-center justify-between gap-3 border-b border-border bg-card px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0 lg:hidden"
                  aria-label="Open navigation"
                  disabled={!navigationReady}
                >
                  <Menu aria-hidden="true" />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="flex w-[min(288px,85vw)] flex-col border-sidebar-border bg-sidebar px-4 pb-6 pt-8 text-sidebar-foreground [&>button]:text-sidebar-foreground"
              >
                <SheetTitle className="sr-only">OpenHuli navigation</SheetTitle>
                <SheetDescription className="sr-only">
                  Navigate between devices, conversations and tasks.
                </SheetDescription>
                <div className="px-2" onClick={() => setMenuOpen(false)}>
                  <Brand />
                </div>
                <div className="mt-8 min-h-0 flex-1 overflow-y-auto">
                  <Navigation onNavigate={() => setMenuOpen(false)} />
                </div>
                <Account />
              </SheetContent>
            </Sheet>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">
                OpenHuli{" "}
                <span aria-hidden="true" className="px-1.5">
                  /
                </span>{" "}
                Your home
              </p>
              <p className="truncate text-lg font-semibold tracking-tight">
                {section?.label ?? "Dashboard"}
              </p>
            </div>
          </div>
          <Badge
            variant="outline"
            className="shrink-0 rounded-md font-normal text-muted-foreground"
          >
            Development preview
          </Badge>
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className="min-w-0 p-4 outline-none sm:p-6 lg:p-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
