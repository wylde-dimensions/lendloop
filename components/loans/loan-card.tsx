"use client";

import type { ReactNode } from "react";
import type { FunctionReturnType } from "convex/server";
import { AlertTriangle, BellRing, CheckCircle2, Clock, Mail, MinusCircle, RotateCw } from "lucide-react";
import type { api } from "@/convex/_generated/api";
import { CATEGORY_LABELS } from "@/convex/model/constants";
import { CategoryIcon } from "@/components/tools/category-icon";
import { TrustedLenderBadge } from "@/components/tools/tool-card";
import { Badge, type Tone } from "@/components/ui/badge";
import { formatRange, formatStamp, formatTimeAgo } from "@/lib/format";

export type LoanView = FunctionReturnType<typeof api.loans.borrowing>[number];
type Activity = LoanView["activity"][number];

const STATUS: Record<LoanView["status"], { label: string; tone: Tone }> = {
  requested: { label: "Waiting for approval", tone: "neutral" },
  approved: { label: "Approved", tone: "brand" },
  declined: { label: "Declined", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  returned: { label: "Returned", tone: "info" },
};

const CLOSED_REASON: Record<NonNullable<LoanView["closedReason"]>, string> = {
  dates_taken: "Another request for these dates was approved.",
  listing_removed: "The listing was removed.",
};

export function LoanStatusBadge({ loan }: { loan: Pick<LoanView, "status" | "overdue"> }) {
  if (loan.overdue) return <Badge tone="danger">Overdue</Badge>;
  const { label, tone } = STATUS[loan.status];
  return <Badge tone={tone}>{label}</Badge>;
}

const ACTIVITY_ICON: Record<Activity["status"], ReactNode> = {
  sent: <CheckCircle2 className="size-4 text-brand" aria-hidden />,
  queued: <Clock className="size-4 text-muted" aria-hidden />,
  sending: <Clock className="size-4 text-muted" aria-hidden />,
  retrying: <RotateCw className="size-4 text-amber" aria-hidden />,
  failed: <AlertTriangle className="size-4 text-danger" aria-hidden />,
  skipped: <MinusCircle className="size-4 text-muted" aria-hidden />,
};

/** What the automation did for this loan: notifications and reminders, newest first. */
export function ActivityTimeline({ activity }: { activity: Activity[] }) {
  if (activity.length === 0) return null;
  return (
    <details className="group mt-3 border-t border-line pt-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-muted hover:text-ink">
        {activity[0].kind === "reminder" ? (
          <BellRing className="size-4" aria-hidden />
        ) : (
          <Mail className="size-4" aria-hidden />
        )}
        <span>
          {activity[0].label} ·{" "}
          <time dateTime={new Date(activity[0].at).toISOString()}>{formatTimeAgo(activity[0].at)}</time>
        </span>
        {activity.length > 1 ? (
          <span className="text-xs group-open:hidden">(+{activity.length - 1} more)</span>
        ) : null}
      </summary>
      <ol className="mt-2 grid gap-1.5 pl-1">
        {activity.map((item, index) => (
          <li key={`${item.at}-${index}`} className="flex items-center gap-2 text-sm">
            {ACTIVITY_ICON[item.status]}
            <span>{item.label}</span>
            <time
              className="text-muted"
              dateTime={new Date(item.at).toISOString()}
              title={formatStamp(item.at)}
            >
              {formatTimeAgo(item.at)}
            </time>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function LoanCard({
  loan,
  counterpartLabel,
  actions,
}: {
  loan: LoanView;
  counterpartLabel: "From" | "Requested by";
  actions?: ReactNode;
}) {
  return (
    <article className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start gap-3">
        <CategoryIcon category={loan.tool.category} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{loan.tool.name}</h3>
            <LoanStatusBadge loan={loan} />
            {loan.tool.removed ? <Badge>Listing removed</Badge> : null}
          </div>
          <p className="mt-0.5 text-sm text-muted">
            {CATEGORY_LABELS[loan.tool.category]} · {formatRange(loan.startDate, loan.endDate)}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            {counterpartLabel} {loan.counterpart.firstName}
            {counterpartLabel === "From" && loan.counterpart.isTrustedLender ? <TrustedLenderBadge /> : null}
          </p>
          {loan.closedReason ? (
            <p className="mt-1 text-sm text-muted">{CLOSED_REASON[loan.closedReason]}</p>
          ) : null}
        </div>
        {actions ? <div className="flex gap-2">{actions}</div> : null}
      </div>
      <ActivityTimeline activity={loan.activity} />
    </article>
  );
}
