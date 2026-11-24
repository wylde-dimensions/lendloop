"use client";

import { useState, type ReactNode } from "react";
import type { FunctionReturnType } from "convex/server";
import { BadgeCheck } from "lucide-react";
import type { api } from "@/convex/_generated/api";
import { CATEGORY_LABELS, CONDITION_LABELS } from "@/convex/model/constants";
import { CategoryIcon } from "@/components/tools/category-icon";
import { AvailabilityBadge } from "@/components/tools/availability-badge";
import { RequestDialog } from "@/components/tools/request-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRange } from "@/lib/format";

type ToolCard = FunctionReturnType<typeof api.tools.list>[number];

export function TrustedLenderBadge() {
  return (
    <Badge tone="info">
      <BadgeCheck className="size-3.5" aria-hidden /> Trusted Lender
    </Badge>
  );
}

export function ToolCardView({ tool, actions }: { tool: ToolCard; actions?: ReactNode }) {
  return (
    <article className="flex flex-col rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <CategoryIcon category={tool.category} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold">{tool.name}</h3>
          <p className="text-sm text-muted">
            {CATEGORY_LABELS[tool.category]} · {CONDITION_LABELS[tool.condition]}
          </p>
        </div>
      </div>
      {tool.description ? (
        <p className="mt-3 line-clamp-3 text-sm whitespace-pre-line text-ink/80">{tool.description}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <AvailabilityBadge availability={tool.availability} />
        {!tool.isMine && tool.owner.isTrustedLender ? <TrustedLenderBadge /> : null}
      </div>
      <div className="mt-4 flex flex-1 items-end justify-between gap-3 border-t border-line pt-3">
        <p className="text-sm text-muted">
          {tool.isMine ? "Your listing" : `Lent by ${tool.owner.firstName}`}
        </p>
        {actions}
      </div>
    </article>
  );
}

/** A tool on the shared board, with the borrow action that fits the viewer. */
export function BrowseToolCard({ tool }: { tool: ToolCard }) {
  const [open, setOpen] = useState(false);
  let action: ReactNode;
  if (tool.isMine) {
    action = null;
  } else if (tool.myRequest) {
    action = (
      <Badge tone={tool.myRequest.status === "approved" ? "brand" : "neutral"}>
        {tool.myRequest.status === "approved" ? "Approved" : "Requested"} ·{" "}
        {formatRange(tool.myRequest.startDate, tool.myRequest.endDate)}
      </Badge>
    );
  } else {
    action = (
      <Button size="sm" onClick={() => setOpen(true)}>
        Request to borrow
      </Button>
    );
  }
  return (
    <>
      <ToolCardView tool={tool} actions={action} />
      {!tool.isMine ? <RequestDialog tool={tool} open={open} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
