"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { CATEGORY_LABELS, CATEGORY_VALUES, type Category } from "@/convex/model/constants";
import { CategoryIcon } from "@/components/tools/category-icon";
import { EmptyState, ListSkeleton } from "@/components/ui/states";
import { cn } from "@/lib/cn";

/** Read-only, live list for visitors: tool name and category, nothing else. */
export function AvailableTools() {
  const tools = useQuery(api.tools.listPublic);
  const [category, setCategory] = useState<Category | "all">("all");

  const present = useMemo(
    () => CATEGORY_VALUES.filter((value) => tools?.some((tool) => tool.category === value)),
    [tools],
  );
  const shown = tools?.filter((tool) => category === "all" || tool.category === category);

  if (tools === undefined) return <ListSkeleton rows={2} label="Loading available tools" />;
  if (tools.length === 0) {
    return (
      <EmptyState title="Nothing to borrow yet">
        Be the first on your street to list a tool. It takes less than a minute.
      </EmptyState>
    );
  }

  return (
    <div>
      <div role="group" aria-label="Filter by category" className="mb-4 flex flex-wrap gap-2">
        {(["all", ...present] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={category === value}
            onClick={() => setCategory(value)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              category === value
                ? "border-brand bg-brand text-white"
                : "border-line-strong bg-surface text-ink hover:border-brand",
            )}
          >
            {value === "all" ? `All (${tools.length})` : CATEGORY_LABELS[value]}
          </button>
        ))}
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown?.map((tool, index) => (
          <li
            key={`${tool.category}-${tool.name}-${index}`}
            className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3"
          >
            <CategoryIcon category={tool.category} />
            <div className="min-w-0">
              <p className="truncate font-medium">{tool.name}</p>
              <p className="text-xs text-muted">{CATEGORY_LABELS[tool.category]}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
