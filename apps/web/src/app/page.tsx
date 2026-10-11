import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAccount, homeFor } from "@/lib/auth";
import { Landing } from "./landing";

export const metadata: Metadata = {
  title: { absolute: "Everprimer — Lessons that grow around your child." },
};

export default async function Home(props: PageProps<"/">) {
  const account = await getAccount();
  if (account) redirect(homeFor(account));
  const sp = await props.searchParams;
  const next = typeof sp.next === "string" ? sp.next : undefined;
  return <Landing next={next} />;
}
