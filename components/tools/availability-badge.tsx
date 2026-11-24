import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { formatDay } from "@/lib/format";

type Availability = FunctionReturnType<typeof api.tools.list>[number]["availability"];

export function AvailabilityBadge({ availability }: { availability: Availability }) {
  if (availability.state === "on_loan") {
    return availability.overdue ? (
      <Badge tone="danger">Overdue since {formatDay(availability.until)}</Badge>
    ) : (
      <Badge tone="amber">On loan until {formatDay(availability.until)}</Badge>
    );
  }
  return (
    <Badge tone="brand">
      Available{availability.nextBookedFrom ? ` · booked from ${formatDay(availability.nextBookedFrom)}` : ""}
    </Badge>
  );
}
