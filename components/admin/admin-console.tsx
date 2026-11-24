"use client";

import { useState } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { CATEGORY_LABELS, LOAN_STATUS_VALUES, LIMITS, type LoanStatus } from "@/convex/model/constants";
import { useMe } from "@/components/board/board-shell";
import { LoanStatusBadge } from "@/components/loans/loan-card";
import { TrustedLenderBadge } from "@/components/tools/tool-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, inputClass } from "@/components/ui/field";
import { EmptyState, ListSkeleton, PageHeader } from "@/components/ui/states";
import { cn } from "@/lib/cn";
import { formatRange, formatStamp, formatTimeAgo } from "@/lib/format";
import { useRun } from "@/lib/use-run";

const TABS = ["Automation", "Listings", "Loans", "People", "Audit log"] as const;
type Tab = (typeof TABS)[number];

export function AdminConsole() {
  const me = useMe();
  const [tab, setTab] = useState<Tab>("Automation");

  if (me.role !== "admin") {
    return (
      <EmptyState title="Admins only">
        This page is for LendLoop admins. Your data is safe either way: every admin action is checked on the
        server.
      </EmptyState>
    );
  }

  return (
    <>
      <PageHeader
        title="Admin"
        description="Moderate listings, see every loan, vouch for lenders and watch the automations."
      />
      <div
        role="tablist"
        aria-label="Admin sections"
        className="mb-6 flex gap-1 overflow-x-auto border-b border-line"
      >
        {TABS.map((name) => (
          <button
            key={name}
            role="tab"
            type="button"
            id={`tab-${name}`}
            aria-selected={tab === name}
            aria-controls={`panel-${name}`}
            onClick={() => setTab(name)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap",
              tab === name ? "border-brand font-medium" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {name}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "Automation" ? <AutomationPanel /> : null}
        {tab === "Listings" ? <ListingsPanel /> : null}
        {tab === "Loans" ? <LoansPanel /> : null}
        {tab === "People" ? <PeoplePanel /> : null}
        {tab === "Audit log" ? <AuditPanel /> : null}
      </div>
    </>
  );
}

const tableClass =
  "w-full text-left text-sm [&_td]:px-3 [&_td]:py-2.5 [&_th]:px-3 [&_th]:py-2 [&_th]:font-medium [&_th]:text-muted";

function TableFrame({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto rounded-2xl border border-line bg-surface">{children}</div>;
}

function AutomationPanel() {
  const health = useQuery(api.admin.automationHealth);
  const [retry, retrying] = useRun(api.admin.retryDelivery);
  const [resolve, resolving] = useRun(api.admin.resolveIncident);
  if (!health) return <ListSkeleton rows={2} label="Loading automation health" />;

  const healthy =
    health.failedDeliveries.length === 0 &&
    health.openIncidents.length === 0 &&
    health.failedReminders.length === 0;

  return (
    <div className="grid gap-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Notifications in flight" value={health.pendingDeliveries} />
        <Stat label="Dead-lettered notifications" value={health.failedDeliveries.length} alert />
        <Stat label="Skipped (n8n not configured or no email)" value={health.skippedDeliveries} />
      </div>

      {healthy ? (
        <p className="flex items-center gap-2 rounded-2xl border border-brand/30 bg-brand-soft p-4 text-sm text-brand-strong">
          <CheckCircle2 className="size-4" aria-hidden /> No failed deliveries, reminders or n8n incidents.
        </p>
      ) : null}

      {health.failedDeliveries.length > 0 ? (
        <section>
          <h2 className="mb-2 font-semibold">Failed notifications (Convex → n8n)</h2>
          <TableFrame>
            <table className={tableClass}>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Loan event</th>
                  <th>Attempts</th>
                  <th>Last error</th>
                  <th>When</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {health.failedDeliveries.map((row) => (
                  <tr key={row.id}>
                    <td className="font-mono text-xs">{row.eventId}</td>
                    <td>{row.loanStatus}</td>
                    <td>{row.attempts}</td>
                    <td className="text-danger">{row.lastError ?? "—"}</td>
                    <td title={formatStamp(row.at)}>{formatTimeAgo(row.at)}</td>
                    <td className="text-right">
                      <Button
                        size="sm"
                        variant="secondary"
                        pending={retrying}
                        onClick={() => retry({ outboxId: row.id }, "Re-queued")}
                      >
                        Retry
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        </section>
      ) : null}

      {health.openIncidents.length > 0 ? (
        <section>
          <h2 className="mb-2 font-semibold">n8n incidents (from the error workflow)</h2>
          <ul className="grid gap-2">
            {health.openIncidents.map((incident) => (
              <li
                key={incident.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-danger/30 bg-danger-soft p-4"
              >
                <div className="text-sm">
                  <p className="flex items-center gap-2 font-medium text-danger">
                    <AlertTriangle className="size-4" aria-hidden /> {incident.workflow}
                    {incident.node ? <span className="font-normal">· {incident.node}</span> : null}
                  </p>
                  <p className="mt-1">{incident.message}</p>
                  <p className="mt-1 text-xs text-muted">
                    {formatStamp(incident.occurredAt)}
                    {incident.executionId ? ` · execution ${incident.executionId}` : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  pending={resolving}
                  onClick={() => resolve({ incidentId: incident.id }, "Marked resolved")}
                >
                  Mark resolved
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {health.failedReminders.length > 0 ? (
        <section>
          <h2 className="mb-2 font-semibold">Failed overdue reminders</h2>
          <p className="mb-2 text-sm text-muted">n8n retries these on its next daily run.</p>
          <TableFrame>
            <table className={tableClass}>
              <thead>
                <tr>
                  <th>Reminder</th>
                  <th>Error</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {health.failedReminders.map((row) => (
                  <tr key={row.reminderKey}>
                    <td className="font-mono text-xs">{row.reminderKey}</td>
                    <td className="text-danger">{row.error ?? "—"}</td>
                    <td>{formatTimeAgo(row.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableFrame>
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value, alert = false }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", alert && value > 0 && "text-danger")}>
        {value}
      </p>
    </div>
  );
}

function ListingsPanel() {
  const listings = useQuery(api.admin.listings);
  const [target, setTarget] = useState<{ id: Id<"tools">; name: string } | null>(null);
  if (!listings) return <ListSkeleton rows={3} label="Loading listings" />;
  if (listings.length === 0) return <EmptyState title="No listings" />;
  return (
    <>
      <TableFrame>
        <table className={tableClass}>
          <thead>
            <tr>
              <th>Tool</th>
              <th>Category</th>
              <th>Owner</th>
              <th>Listed</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {listings.map((tool) => (
              <tr key={tool.id}>
                <td className="font-medium">{tool.name}</td>
                <td>{CATEGORY_LABELS[tool.category]}</td>
                <td>{tool.owner.firstName}</td>
                <td title={formatStamp(tool.listedAt)}>{formatTimeAgo(tool.listedAt)}</td>
                <td className="text-right">
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => setTarget({ id: tool.id, name: tool.name })}
                  >
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>
      <RemoveListingDialog target={target} onClose={() => setTarget(null)} />
    </>
  );
}

function RemoveListingDialog({
  target,
  onClose,
}: {
  target: { id: Id<"tools">; name: string } | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [remove, pending] = useRun(api.admin.removeListing);
  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title={`Remove ${target?.name ?? "listing"}?`}
      description="Pending requests and future bookings are cancelled and those borrowers notified. A loan in progress stays open so it can be returned."
    >
      <form
        className="grid gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!target) return;
          if (
            (await remove({ toolId: target.id, reason: reason || undefined }, "Listing removed")) !==
            undefined
          ) {
            setReason("");
            onClose();
          }
        }}
      >
        <Field label="Reason (for the audit log)">
          {(props) => (
            <input
              {...props}
              className={inputClass}
              maxLength={LIMITS.reasonMax}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Duplicate listing"
            />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" pending={pending}>
            Remove listing
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function LoansPanel() {
  const [status, setStatus] = useState<LoanStatus | "">("");
  const {
    results,
    status: pageStatus,
    loadMore,
  } = usePaginatedQuery(api.admin.loans, { status: status || undefined }, { initialNumItems: 25 });
  return (
    <div className="grid gap-4">
      <label className="flex max-w-xs items-center gap-2 text-sm">
        <span className="shrink-0">Status</span>
        <select
          className={inputClass}
          value={status}
          onChange={(e) => setStatus(e.target.value as LoanStatus | "")}
        >
          <option value="">All</option>
          {LOAN_STATUS_VALUES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      {pageStatus === "LoadingFirstPage" ? (
        <ListSkeleton rows={3} label="Loading loans" />
      ) : results.length === 0 ? (
        <EmptyState title="No loans" />
      ) : (
        <TableFrame>
          <table className={tableClass}>
            <thead>
              <tr>
                <th>Tool</th>
                <th>Lender → borrower</th>
                <th>Dates</th>
                <th>Status</th>
                <th>Last automation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {results.map((loan) => (
                <tr key={loan.id}>
                  <td className="font-medium">{loan.toolName}</td>
                  <td>
                    {loan.lenderFirstName} → {loan.borrowerFirstName}
                  </td>
                  <td className="whitespace-nowrap">{formatRange(loan.startDate, loan.endDate)}</td>
                  <td>
                    <LoanStatusBadge loan={loan} />
                  </td>
                  <td className="text-muted">
                    {loan.activity[0]
                      ? `${loan.activity[0].label} · ${formatTimeAgo(loan.activity[0].at)}`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      )}
      {pageStatus === "CanLoadMore" ? (
        <Button variant="secondary" className="justify-self-start" onClick={() => loadMore(25)}>
          Load more
        </Button>
      ) : null}
    </div>
  );
}

function PeoplePanel() {
  const users = useQuery(api.admin.users);
  const [setTrusted, pending] = useRun(api.admin.setTrustedLender);
  if (!users) return <ListSkeleton rows={3} label="Loading people" />;
  return (
    <>
      <p className="mb-3 text-sm text-muted">
        Emails are shown to admins only, to tell people with the same first name apart. Admin roles are
        granted from the command line, not here (see README).
      </p>
      <TableFrame>
        <table className={tableClass}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Listings</th>
              <th>Trusted Lender</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {users.map((user) => (
              <tr key={user.id}>
                <td className="font-medium">
                  {user.firstName}
                  {user.isMe ? <span className="ml-1 text-muted">(you)</span> : null}
                </td>
                <td className="text-muted">{user.email ?? "unverified"}</td>
                <td>{user.role === "admin" ? <Badge tone="info">admin</Badge> : "user"}</td>
                <td>{user.listings}</td>
                <td>
                  <div className="flex items-center gap-2">
                    {user.isTrustedLender ? <TrustedLenderBadge /> : null}
                    <Button
                      size="sm"
                      variant={user.isTrustedLender ? "ghost" : "secondary"}
                      pending={pending}
                      onClick={() =>
                        setTrusted(
                          { userId: user.id, trusted: !user.isTrustedLender },
                          user.isTrustedLender
                            ? `${user.firstName} is no longer a Trusted Lender`
                            : `${user.firstName} is now a Trusted Lender`,
                        )
                      }
                    >
                      {user.isTrustedLender ? "Revoke" : "Mark trusted"}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>
    </>
  );
}

function AuditPanel() {
  const entries = useQuery(api.admin.auditLog);
  if (!entries) return <ListSkeleton rows={3} label="Loading audit log" />;
  if (entries.length === 0) return <EmptyState title="Nothing logged yet" />;
  return (
    <TableFrame>
      <table className={tableClass}>
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>Action</th>
            <th>Target</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td className="whitespace-nowrap" title={formatStamp(entry.at)}>
                {formatTimeAgo(entry.at)}
              </td>
              <td>{entry.actor}</td>
              <td className="font-mono text-xs">{entry.action}</td>
              <td className="font-mono text-xs text-muted">{entry.targetId}</td>
              <td className="text-muted">{entry.details ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}
