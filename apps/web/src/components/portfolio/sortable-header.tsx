import { ArrowUpDown } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SortField } from "./types";

export function SortableHeader({
  label,
  field,
  currentSort,
  onSort,
  className = "",
  tooltip,
}: {
  label: string;
  field: SortField;
  currentSort: SortField;
  onSort: (field: SortField) => void;
  className?: string;
  tooltip?: string;
}) {
  const isActive = currentSort === field;

  const content = (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={`flex items-center gap-1 hover:text-foreground transition-colors ${className} ${
        isActive ? "text-foreground" : ""
      }`}
    >
      {label}
      <ArrowUpDown
        className={`h-3 w-3 ${isActive ? "text-primary" : "opacity-50"}`}
      />
    </button>
  );

  if (tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-[200px]">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    );
  }

  return content;
}
