import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTenantContext } from "@/server/tenant-context";
import { IdentityError, readAuthConfig } from "@corely/modules-identity";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";

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
  return <DashboardShell>{children}</DashboardShell>;
}
