import { redirect } from "next/navigation";
import { getAccount, homeFor } from "@/lib/auth";

export default async function Home() {
  const account = await getAccount();
  redirect(account ? homeFor(account) : "/login");
}
