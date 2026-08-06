import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import ChangePasswordView from "@/components/ChangePasswordView";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <ChangePasswordView username={session.username} forced={session.mustChange === true} />;
}
