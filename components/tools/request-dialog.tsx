"use client";

import { useState } from "react";
import Link from "next/link";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";
import { addDays, daysBetween, rangesOverlap } from "@/convex/model/dates";
import { LIMITS } from "@/convex/model/constants";
import { Dialog } from "@/components/ui/dialog";
import { Field, inputClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { formatRange, localToday } from "@/lib/format";
import { useRun } from "@/lib/use-run";

type ToolCard = FunctionReturnType<typeof api.tools.list>[number];

export function RequestDialog({
  tool,
  open,
  onClose,
}: {
  tool: ToolCard;
  open: boolean;
  onClose: () => void;
}) {
  const today = localToday();
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(addDays(today, 2));
  const [request, pending] = useRun(api.loans.request);

  // Mirrors the server's rules so mistakes show up before submitting.
  // The server checks all of these again; this is for the person, not for security.
  const problem =
    !startDate || !endDate
      ? "Pick a start and a return date."
      : endDate < startDate
        ? "The return date must be on or after the start date."
        : daysBetween(startDate, endDate) + 1 > LIMITS.maxLoanDays
          ? `Loans can be at most ${LIMITS.maxLoanDays} days.`
          : tool.booked.some((range) => rangesOverlap(range, { startDate, endDate }))
            ? "Those dates overlap an existing booking."
            : null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (problem) return;
    const loanId = await request(
      { toolId: tool.id, startDate, endDate },
      `Request sent. ${tool.owner.firstName} will be notified.`,
    );
    if (loanId) onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Borrow ${tool.name}`}
      description={`From ${tool.owner.firstName}. They'll get a notification and can approve or decline.`}
    >
      <form onSubmit={submit} className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="From">
            {(props) => (
              <input
                {...props}
                type="date"
                required
                className={inputClass}
                min={today}
                max={addDays(today, LIMITS.maxAdvanceDays)}
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (e.target.value > endDate) setEndDate(e.target.value);
                }}
              />
            )}
          </Field>
          <Field label="Return by">
            {(props) => (
              <input
                {...props}
                type="date"
                required
                className={inputClass}
                min={startDate || today}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            )}
          </Field>
        </div>

        {tool.booked.length > 0 ? (
          <div className="rounded-lg bg-paper p-3 text-sm">
            <p className="font-medium">Already booked</p>
            <ul className="mt-1 text-muted">
              {tool.booked.map((range) => (
                <li key={range.startDate}>{formatRange(range.startDate, range.endDate)}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <p role="status" className="min-h-5 text-sm text-danger">
          {problem && startDate && endDate ? problem : ""}
        </p>

        <div className="flex items-center justify-between gap-3">
          <Link href="/borrowing" className="text-sm text-muted underline-offset-4 hover:underline">
            See my requests
          </Link>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" pending={pending} disabled={Boolean(problem)}>
              Send request
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
