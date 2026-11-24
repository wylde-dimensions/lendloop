"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { LoanCard, type LoanView } from "@/components/loans/loan-card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState, ListSkeleton, PageHeader, Section } from "@/components/ui/states";
import { useRun } from "@/lib/use-run";

export function BorrowingList() {
  const loans = useQuery(api.loans.borrowing);

  return (
    <>
      <PageHeader
        title="My requests"
        description="Everything you've asked to borrow, and what happened to it."
      />
      {loans === undefined ? (
        <ListSkeleton rows={3} label="Loading your requests" />
      ) : loans.length === 0 ? (
        <EmptyState
          title="No requests yet"
          action={
            <Link href="/tools" className="text-sm font-medium text-brand underline-offset-4 hover:underline">
              Browse tools
            </Link>
          }
        >
          When you ask to borrow something, it shows up here with its status.
        </EmptyState>
      ) : (
        <Groups loans={loans} />
      )}
    </>
  );
}

function Groups({ loans }: { loans: LoanView[] }) {
  const waiting = loans.filter((loan) => loan.status === "requested");
  const active = loans.filter((loan) => loan.status === "approved");
  const past = loans.filter((loan) => loan.status !== "requested" && loan.status !== "approved");
  return (
    <>
      {active.length > 0 ? (
        <Section title="Borrowing" count={active.length}>
          <div className="grid gap-3">
            {active.map((loan) => (
              <LoanCard key={loan.id} loan={loan} counterpartLabel="From" />
            ))}
          </div>
        </Section>
      ) : null}
      {waiting.length > 0 ? (
        <Section title="Waiting for an answer" count={waiting.length}>
          <div className="grid gap-3">
            {waiting.map((loan) => (
              <LoanCard
                key={loan.id}
                loan={loan}
                counterpartLabel="From"
                actions={<CancelButton loan={loan} />}
              />
            ))}
          </div>
        </Section>
      ) : null}
      {past.length > 0 ? (
        <Section title="Past" count={past.length}>
          <div className="grid gap-3">
            {past.map((loan) => (
              <LoanCard key={loan.id} loan={loan} counterpartLabel="From" />
            ))}
          </div>
        </Section>
      ) : null}
    </>
  );
}

function CancelButton({ loan }: { loan: LoanView }) {
  const [open, setOpen] = useState(false);
  const [cancel, pending] = useRun(api.loans.cancel);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Cancel request
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Cancel your request for ${loan.tool.name}?`}
        confirmLabel="Cancel request"
        danger
        pending={pending}
        onConfirm={async () => {
          if ((await cancel({ loanId: loan.id }, "Request cancelled")) !== undefined) setOpen(false);
        }}
      >
        {loan.counterpart.firstName} will be told you no longer need it.
      </ConfirmDialog>
    </>
  );
}
