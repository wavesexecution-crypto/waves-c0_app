import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function HomePage() {
  const session = await auth();
  const tenantId = (session as any)?.user?.tenantId as string | undefined;
  const isAuthenticated = typeof tenantId === "string" && tenantId.length > 0;
  if (isAuthenticated) {
    redirect("/overview");
  }
  redirect("/login");
}
