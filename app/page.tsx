import { CalendarCheck, Handshake, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/brand";
import { AuthAction } from "@/components/public/auth-action";
import { AvailableTools } from "@/components/public/available-tools";

const steps = [
  {
    icon: Handshake,
    title: "List what's in your garage",
    body: "Add the drill you use twice a year. You decide who borrows it and when.",
  },
  {
    icon: CalendarCheck,
    title: "Request the dates you need",
    body: "Pick a date range. The lender approves or declines, and you both get notified.",
  },
  {
    icon: ShieldCheck,
    title: "Reminders do the nagging",
    body: "If a return date slips, LendLoop sends a polite reminder so neighbors don't have to.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <Logo />
        <AuthAction size="sm" />
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6">
        <section className="grid gap-10 py-12 md:grid-cols-[1.2fr_1fr] md:items-center md:py-20">
          <div>
            <p className="mb-4 inline-flex rounded-full bg-brand-soft px-3 py-1 text-sm font-medium text-brand-strong">
              A tool-lending board for your neighborhood
            </p>
            <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-5xl">
              Borrow what you need. Lend what you don&apos;t.
            </h1>
            <p className="mt-4 max-w-xl text-lg text-pretty text-muted">
              Most tools spend their lives in a drawer. LendLoop helps neighbors share them, with approvals,
              return dates and automatic reminders built in.
            </p>
            <div className="mt-8">
              <AuthAction />
            </div>
          </div>
          <ol className="grid gap-3">
            {steps.map(({ icon: Icon, title, body }, index) => (
              <li key={title} className="flex gap-4 rounded-2xl border border-line bg-surface p-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-brand text-white">
                  <Icon className="size-5" aria-hidden />
                </span>
                <div>
                  <p className="font-medium">
                    <span className="sr-only">Step {index + 1}: </span>
                    {title}
                  </p>
                  <p className="mt-0.5 text-sm text-muted">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="available-heading" className="pb-16">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="available-heading" className="text-xl font-semibold">
              Available to borrow right now
            </h2>
            <p className="text-sm text-muted">Owners and details are visible after you sign in.</p>
          </div>
          <AvailableTools />
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-6 py-6 text-sm text-muted">
          <p>LendLoop is a fictional company built as a take-home exercise.</p>
          <p>We share first names only, and only with the neighbor you&apos;re lending to.</p>
        </div>
      </footer>
    </div>
  );
}
