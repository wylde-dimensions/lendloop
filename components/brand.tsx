import Link from "next/link";
import { Repeat2 } from "lucide-react";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-2 font-semibold tracking-tight">
      <span className="grid size-8 place-items-center rounded-lg bg-brand text-white">
        <Repeat2 className="size-5" aria-hidden />
      </span>
      <span className="text-lg">LendLoop</span>
    </Link>
  );
}
