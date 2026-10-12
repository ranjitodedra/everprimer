import type { Metadata } from "next";
import { EverprimerMark } from "@/components/logo";
import { LoginForm } from "./login-form";
import { parseMode, parseWho } from "./who";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage(props: PageProps<"/login">) {
  const sp = await props.searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/";
  const who = parseWho(sp.who);
  const mode = parseMode(sp.mode);
  return (
    <main className="flex flex-1 flex-col px-5 pt-[max(1rem,env(safe-area-inset-top,0px))] pb-[max(2rem,env(safe-area-inset-bottom,0px))] sm:items-center sm:justify-center sm:py-16">
      <div className="w-full max-w-md">
        <EverprimerMark className="mb-4 h-10 w-10" />
        <LoginForm next={next} who={who} initialMode={mode} />
      </div>
    </main>
  );
}
