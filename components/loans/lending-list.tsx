"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { LoanCard, type LoanView } from "@/components/loans/loan-card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState, ListSkeleton, PageHeader, Section } from "@/components/ui/states";
import { localToday } from "@/lib/format";
import { useRun } from "@/lib/use-run";

export function LendingList() {
  const loans = useQuery(api.loans.lending);
  const today = localToday();

  return (
    <>
      <PageHeader
        title="Incoming requests"
        description="Requests to borrow your tools. Approve, decline, and mark returns."
      />
      {loans === undefined ? (
        <ListSkeleton rows={3} label="Loading incoming requests" />
      ) : loans.length === 0 ? (
        <EmptyState
          title="No requests yet"
          action={
            <Link
              href="/listings"
              className="text-sm font-medium text-brand underline-offset-4 hover:underline"
            >
              Manage my listings
            </Link>
          }
        >
          When a neighbor asks to borrow one of your tools, you&apos;ll decide here.
        </EmptyState>
      ) : (
        <>
          <Group
            title="To decide"
            loans={loans.filter((loan) => loan.status === "requested" && loan.endDate >= today)}
            render={(loan) => <DecisionButtons loan={loan} />}
          />
          <Group
            title="Out on loan or booked"
            loans={loans
              .filter((loan) => loan.status === "approved")
              .sort(
                (a, b) => Number(b.overdue) - Number(a.overdue) || a.startDate.localeCompare(b.startDate),
              )}
            render={(loan) => <ReturnButton loan={loan} />}
          />
          <Group
            title="History"
            loans={loans.filter(
              (loan) =>
                !(loan.status === "approved" || (loan.status === "requested" && loan.endDate >= today)),
            )}
            render={(loan) =>
              loan.status === "requested" ? <DecisionButtons loan={loan} declineOnly /> : null
            }
          />
        </>
      )}
    </>
  );
}

function Group({
  title,
  loans,
  render,
}: {
  title: string;
  loans: LoanView[];
  render: (loan: LoanView) => React.ReactNode;
}) {
  if (loans.length === 0) return null;
  return (
    <Section title={title} count={loans.length}>
      <div className="grid gap-3">
        {loans.map((loan) => (
          <LoanCard key={loan.id} loan={loan} counterpartLabel="Requested by" actions={render(loan)} />
        ))}
      </div>
    </Section>
  );
}

/** `declineOnly` is for requests whose dates have passed: they can be closed but not approved. */
function DecisionButtons({ loan, declineOnly = false }: { loan: LoanView; declineOnly?: boolean }) {
  const [approve, approving] = useRun(api.loans.approve);
  const [decline, declining] = useRun(api.loans.decline);
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        pending={declining}
        disabled={approving}
        onClick={() =>
          decline({ loanId: loan.id }, `Declined. ${loan.counterpart.firstName} will be notified.`)
        }
      >
        Decline
      </Button>
      {declineOnly ? null : (
        <Button
          size="sm"
          pending={approving}
          disabled={declining}
          onClick={() =>
            approve({ loanId: loan.id }, `Approved. ${loan.counterpart.firstName} will be notified.`)
          }
        >
          Approve
        </Button>
      )}
    </>
  );
}

function ReturnButton({ loan }: { loan: LoanView }) {
  const [open, setOpen] = useState(false);
  const [markReturned, pending] = useRun(api.loans.markReturned);
  return (
    <>
      <Button size="sm" variant={loan.overdue ? "primary" : "secondary"} onClick={() => setOpen(true)}>
        Mark returned
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Got your ${loan.tool.name} back?`}
        confirmLabel="Mark returned"
        pending={pending}
        onConfirm={async () => {
          if ((await markReturned({ loanId: loan.id }, "Marked as returned")) !== undefined) setOpen(false);
        }}
      >
        This closes the loan, stops reminders, and makes the tool available again.
      </ConfirmDialog>
    </>
  );
}
