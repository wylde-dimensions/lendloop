import {
  Drill,
  Flower2,
  Hammer,
  Package,
  Sparkles,
  Tent,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import { Ladder } from "@/components/tools/ladder-icon";
import type { Category } from "@/convex/model/constants";

const icons: Record<Category, LucideIcon | typeof Ladder> = {
  power_tools: Drill,
  hand_tools: Hammer,
  garden: Flower2,
  kitchen: UtensilsCrossed,
  camping: Tent,
  cleaning: Sparkles,
  ladders_moving: Ladder,
  other: Package,
};

export function CategoryIcon({ category }: { category: Category }) {
  const Icon = icons[category];
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-strong">
      <Icon className="size-5" aria-hidden />
    </span>
  );
}
