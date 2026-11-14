import { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import clsx from "clsx";

interface Props {
  sidebar:      ReactNode;   // filters + asset list
  detail:       ReactNode;   // selected asset analysis (or an empty state on desktop)
  hasSelection: boolean;
  onBack:       () => void;
  backLabel?:   string;
}

/**
 * Two-column workspace on large screens; on phones/tablets it behaves like a
 * master–detail flow: the list fills the screen, and selecting an asset shows
 * the detail view with a "Back" control. This replaces the fixed 288px sidebar
 * that previously forced horizontal scrolling on mobile.
 */
export default function AssetWorkspace({ sidebar, detail, hasSelection, onBack, backLabel = "Back to list" }: Props) {
  return (
    <div className="lg:flex lg:gap-4 lg:items-start">
      <aside
        className={clsx(
          "space-y-3 lg:w-72 xl:w-80 lg:flex-shrink-0 lg:sticky lg:top-[112px]",
          hasSelection && "hidden lg:block",
        )}
      >
        {sidebar}
      </aside>

      <section className={clsx("flex-1 min-w-0", !hasSelection && "hidden lg:block")}>
        {hasSelection && (
          <button
            type="button"
            onClick={onBack}
            className="lg:hidden mb-2 -ml-2 inline-flex items-center gap-1 min-h-[44px] px-2 text-sm font-medium text-accent"
          >
            <ChevronLeft className="w-4 h-4" />
            {backLabel}
          </button>
        )}
        {detail}
      </section>
    </div>
  );
}

export function EmptyDetail({ message }: { message: string }) {
  return (
    <div className="card h-full min-h-[280px] flex items-center justify-center">
      <div className="text-center text-muted py-16 px-6">
        <ChevronLeft className="w-10 h-10 mx-auto mb-3 opacity-30 rotate-180" />
        <p className="text-sm">{message}</p>
      </div>
    </div>
  );
}
