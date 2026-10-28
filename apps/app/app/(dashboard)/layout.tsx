import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTenantContext } from "@/server/tenant-context";
import { IdentityError, readAuthConfig } from "@corely/modules-identity";
import { OwnerMenu } from "@/components/auth/owner-menu";
import { Badge } from "@corely/ui";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const incoming = await headers();
  try {
    await getTenantContext(
      new Request(`${readAuthConfig().origin}/todos`, { headers: incoming }),
    );
  } catch (error) {
    if (error instanceof IdentityError && [401, 403].includes(error.status))
      redirect("/login");
    throw error;
  }
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur">
        <div className="container flex flex-wrap items-center justify-between gap-3 py-4">
          <div className="flex items-center gap-3">
            <Link
              href="/todos"
              className="text-lg font-semibold tracking-tight"
            >
              OpenHuli
            </Link>
            <Badge variant="secondary" className="rounded-full px-3 py-1">
              Development preview
            </Badge>
          </div>
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link href="/conversations">Conversations</Link>
            <Link href="/todos">Todos</Link>
            <OwnerMenu />
          </nav>
        </div>
      </header>
      <main className="container py-8">{children}</main>
    </div>
  );
}
