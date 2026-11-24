"use client";

import { useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import {
  CATEGORY_LABELS,
  CATEGORY_VALUES,
  CONDITION_LABELS,
  CONDITION_VALUES,
  LIMITS,
  type Category,
  type Condition,
} from "@/convex/model/constants";
import { Dialog } from "@/components/ui/dialog";
import { Field, inputClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { useRun } from "@/lib/use-run";

export type ToolDraft = { name: string; category: Category; condition: Condition; description: string };

const empty: ToolDraft = { name: "", category: "power_tools", condition: "good", description: "" };

/** Create a listing, or edit one when `toolId` and `initial` are given. */
export function ToolFormDialog({
  open,
  onClose,
  toolId,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  toolId?: Id<"tools">;
  initial?: ToolDraft;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={toolId ? "Edit listing" : "List a tool"}
      description={
        toolId
          ? undefined
          : "Neighbors see the name, category, condition and description, plus your first name."
      }
    >
      {/* Keyed so the form resets each time it opens for a different tool. */}
      <ToolForm key={toolId ?? "new"} toolId={toolId} initial={initial ?? empty} onDone={onClose} />
    </Dialog>
  );
}

function ToolForm({
  toolId,
  initial,
  onDone,
}: {
  toolId?: Id<"tools">;
  initial: ToolDraft;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState<ToolDraft>(initial);
  const [create, creating] = useRun(api.tools.create);
  const [update, updating] = useRun(api.tools.update);
  const set = <K extends keyof ToolDraft>(key: K, value: ToolDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const ok = toolId
      ? (await update({ toolId, ...draft }, "Listing updated")) !== undefined
      : (await create(draft, `${draft.name.trim()} is listed`)) !== undefined;
    if (ok) onDone();
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label="Name">
        {(props) => (
          <input
            {...props}
            required
            maxLength={LIMITS.toolNameMax}
            className={inputClass}
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. Cordless drill"
            autoFocus
          />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          {(props) => (
            <select
              {...props}
              className={inputClass}
              value={draft.category}
              onChange={(e) => set("category", e.target.value as Category)}
            >
              {CATEGORY_VALUES.map((value) => (
                <option key={value} value={value}>
                  {CATEGORY_LABELS[value]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Condition">
          {(props) => (
            <select
              {...props}
              className={inputClass}
              value={draft.condition}
              onChange={(e) => set("condition", e.target.value as Condition)}
            >
              {CONDITION_VALUES.map((value) => (
                <option key={value} value={value}>
                  {CONDITION_LABELS[value]}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <Field
        label="Short description"
        hint={`${draft.description.length}/${LIMITS.descriptionMax}. What's included, any quirks. Skip your address and phone number.`}
      >
        {(props) => (
          <textarea
            {...props}
            rows={3}
            maxLength={LIMITS.descriptionMax}
            className={inputClass}
            value={draft.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="18V, two batteries and a charger."
          />
        )}
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" pending={creating || updating} disabled={!draft.name.trim()}>
          {toolId ? "Save changes" : "List tool"}
        </Button>
      </div>
    </form>
  );
}
