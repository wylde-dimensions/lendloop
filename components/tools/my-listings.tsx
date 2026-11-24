"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Pencil, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { ToolCardView } from "@/components/tools/tool-card";
import { ToolFormDialog } from "@/components/tools/tool-form-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState, ListSkeleton, PageHeader } from "@/components/ui/states";
import { useRun } from "@/lib/use-run";

type ToolCard = FunctionReturnType<typeof api.tools.list>[number];

export function MyListings() {
  const tools = useQuery(api.tools.list, { mineOnly: true });
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [creating, setCreating] = useState(params.get("new") === "1");

  function closeCreate() {
    setCreating(false);
    if (params.get("new")) router.replace(pathname, { scroll: false });
  }

  return (
    <>
      <PageHeader
        title="My listings"
        description="Tools you're lending. Only you can edit or delete them."
        action={<Button onClick={() => setCreating(true)}>List a tool</Button>}
      />
      {tools === undefined ? (
        <ListSkeleton rows={2} label="Loading your listings" />
      ) : tools.length === 0 ? (
        <EmptyState
          title="You haven't listed anything yet"
          action={<Button onClick={() => setCreating(true)}>List a tool</Button>}
        >
          A ladder, a tent, a stand mixer: whatever you&apos;d lend a neighbor.
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => (
            <MyToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      )}
      <ToolFormDialog open={creating} onClose={closeCreate} />
    </>
  );
}

function MyToolCard({ tool }: { tool: ToolCard }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [remove, removing] = useRun(api.tools.remove);

  return (
    <>
      <ToolCardView
        tool={tool}
        actions={
          <div className="flex items-center gap-1">
            {tool.pendingRequests > 0 ? (
              <Link
                href="/lending"
                className="mr-2 text-sm font-medium text-brand underline-offset-4 hover:underline"
              >
                {tool.pendingRequests} request{tool.pendingRequests === 1 ? "" : "s"}
              </Link>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditing(true)}
              aria-label={`Edit ${tool.name}`}
            >
              <Pencil className="size-4" aria-hidden />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDeleting(true)}
              aria-label={`Delete ${tool.name}`}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </div>
        }
      />
      <ToolFormDialog
        open={editing}
        onClose={() => setEditing(false)}
        toolId={tool.id}
        initial={{
          name: tool.name,
          category: tool.category,
          condition: tool.condition,
          description: tool.description,
        }}
      />
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title={`Delete ${tool.name}?`}
        confirmLabel="Delete listing"
        danger
        pending={removing}
        onConfirm={async () => {
          const done = await remove({ toolId: tool.id }, "Listing deleted");
          if (done !== undefined) setDeleting(false);
        }}
      >
        Pending requests and future bookings will be cancelled, and those neighbors notified. You can&apos;t
        delete a tool while it&apos;s out on loan.
      </ConfirmDialog>
    </>
  );
}
