"use client";

import { useDeferredValue, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { Search } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { CATEGORY_LABELS, CATEGORY_VALUES, type Category } from "@/convex/model/constants";
import { BrowseToolCard } from "@/components/tools/tool-card";
import { EmptyState, ListSkeleton, PageHeader } from "@/components/ui/states";
import { inputClass } from "@/components/ui/field";
import { cn } from "@/lib/cn";

function isCategory(value: string | null): value is Category {
  return value !== null && (CATEGORY_VALUES as readonly string[]).includes(value);
}

export function ToolsBoard() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params.get("category");
  const category = isCategory(raw) ? raw : undefined;

  // The category filter runs in Convex (indexed); the name search is client-side.
  const tools = useQuery(api.tools.list, { category });
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search.trim().toLowerCase());
  const shown = tools?.filter((tool) => !query || tool.name.toLowerCase().includes(query));

  function setCategory(next: Category | undefined) {
    const nextParams = new URLSearchParams(params);
    if (next) nextParams.set("category", next);
    else nextParams.delete("category");
    router.replace(nextParams.size ? `${pathname}?${nextParams}` : pathname, { scroll: false });
  }

  return (
    <>
      <PageHeader
        title="Tools in your neighborhood"
        description="Everything your neighbors are willing to lend, with when it's free."
        action={
          <Link
            href="/listings?new=1"
            className="inline-flex h-10 items-center rounded-lg bg-brand px-4 text-sm font-medium text-white hover:bg-brand-strong"
          >
            List a tool
          </Link>
        }
      />

      <div className="mb-6 grid gap-3">
        <label className="relative block max-w-sm">
          <span className="sr-only">Search tools by name</span>
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name"
            className={cn(inputClass, "pl-9")}
          />
        </label>
        <div role="group" aria-label="Filter by category" className="flex flex-wrap gap-2">
          {([undefined, ...CATEGORY_VALUES] as const).map((value) => (
            <button
              key={value ?? "all"}
              type="button"
              aria-pressed={category === value}
              onClick={() => setCategory(value)}
              className={cn(
                "rounded-full border px-3 py-1 text-sm transition-colors",
                category === value
                  ? "border-brand bg-brand text-white"
                  : "border-line-strong bg-surface hover:border-brand",
              )}
            >
              {value ? CATEGORY_LABELS[value] : "All"}
            </button>
          ))}
        </div>
      </div>

      {shown === undefined ? (
        <ListSkeleton rows={3} label="Loading tools" />
      ) : shown.length === 0 ? (
        <EmptyState
          title={query || category ? "No tools match" : "No tools listed yet"}
          action={
            query || category ? undefined : (
              <Link
                href="/listings?new=1"
                className="text-sm font-medium text-brand underline-offset-4 hover:underline"
              >
                List the first one
              </Link>
            )
          }
        >
          {query || category ? "Try another category or search." : "Be the first to share something."}
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((tool) => (
            <BrowseToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      )}
    </>
  );
}
