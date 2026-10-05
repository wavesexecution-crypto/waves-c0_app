import Link from "next/link";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">404</p>
      <h1 className="mt-2 font-display text-2xl font-semibold tracking-[-0.02em]">This page does not exist</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        The link may be out of date. Nothing is wrong with your account or your data.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/command"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Command Center
        </Link>
        <Link
          href="/acquisition"
          className="rounded-md border border-border px-4 py-2 text-sm transition-colors hover:bg-accent"
        >
          Acquisition OS
        </Link>
      </div>
    </main>
  );
}