"use client";

import Link from "next/link";
import { memo } from "react";
import { Button } from "@/components/ui/button";
import { ShareIcon } from "./icons";
import { SidebarToggle } from "./sidebar-toggle";

function PureChatHeader({
  isReadonly,
  project,
  readyResourceCount = 0,
}: {
  isReadonly: boolean;
  project?: { id: string; name: string } | null;
  readyResourceCount?: number;
}) {
  return (
    <header className="sticky top-0 z-10 flex min-h-12 items-center gap-2 bg-background/90 px-2 py-1.5 backdrop-blur-sm md:px-3">
      <SidebarToggle className="size-11 px-0 md:hidden" />
      <div className="min-w-0 flex-1">
        {project ? (
          <Link
            className="block max-w-fit truncate rounded-md px-2 py-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={`/projects/${project.id}`}
          >
            <span className="block truncate font-medium text-sm">
              {project.name}
            </span>
            <span className="block text-muted-foreground text-xs">
              {readyResourceCount} searchable files
            </span>
          </Link>
        ) : (
          <span className="sr-only">Independent chat</span>
        )}
      </div>

      {!isReadonly && (
        <Button className="min-h-11 px-3 md:min-h-8 md:px-2" variant="outline">
          <ShareIcon />
          <span>Shared</span>
        </Button>
      )}
    </header>
  );
}

export const ChatHeader = memo(PureChatHeader, (prevProps, nextProps) => {
  return (
    prevProps.isReadonly === nextProps.isReadonly &&
    prevProps.project?.id === nextProps.project?.id &&
    prevProps.project?.name === nextProps.project?.name &&
    prevProps.readyResourceCount === nextProps.readyResourceCount
  );
});
