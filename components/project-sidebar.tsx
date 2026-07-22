"use client";

import {
  ChevronDown,
  ChevronRight,
  Folder,
  MessageSquare,
  Plus,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { User } from "next-auth";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import type { Chat, Project } from "@/lib/db/schema";
import { fetcher } from "@/lib/utils";
import { toast } from "./toast";

type ProjectSummary = Project & {
  chatCount: number;
  readyResourceCount: number;
  recentChats: Chat[];
};

type ProjectsResponse = { projects: ProjectSummary[] };

export const PROJECTS_CACHE_KEY = "/api/projects";

export function ProjectSidebar({ user }: { user: User | undefined }) {
  const pathname = usePathname();
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  const { data, isLoading, mutate } = useSWR<ProjectsResponse>(
    user ? PROJECTS_CACHE_KEY : null,
    fetcher
  );
  const [openProjects, setOpenProjects] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const activeChatId = pathname.startsWith("/chat/")
    ? pathname.split("/")[2]
    : null;
  const activeProjectId = pathname.startsWith("/projects/")
    ? pathname.split("/")[2]
    : data?.projects.find((project) =>
        project.recentChats.some((chat) => chat.id === activeChatId)
      )?.id;

  useEffect(() => {
    if (!activeProjectId) {
      return;
    }
    setOpenProjects((current) => {
      if (current.has(activeProjectId)) {
        return current;
      }
      return new Set([...current, activeProjectId]);
    });
  }, [activeProjectId]);

  const createProject = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return;
    }
    setCreating(true);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName }),
      });
      if (!response.ok) {
        throw new Error("We couldn't create the project. Please try again.");
      }
      const result = (await response.json()) as { project: Project };
      await mutate();
      setName("");
      setCreateOpen(false);
      setOpenMobile(false);
      router.push(`/projects/${result.project.id}`);
      router.refresh();
    } catch (error) {
      toast({
        type: "error",
        description:
          error instanceof Error ? error.message : "Project creation failed.",
      });
    } finally {
      setCreating(false);
    }
  };

  if (!user) {
    return null;
  }

  return (
    <>
      <SidebarGroup className="px-2 py-1">
        <SidebarGroupLabel>Projects</SidebarGroupLabel>
        <SidebarGroupAction
          aria-label="Create project"
          className="after:-inset-3"
          onClick={() => setCreateOpen(true)}
          title="Create project"
        >
          <Plus />
        </SidebarGroupAction>
        <SidebarGroupContent>
          <SidebarMenu>
            {isLoading && (
              <div className="space-y-1 px-2 py-1">
                <span className="sr-only">Loading projects</span>
                <div className="h-7 animate-pulse rounded-md bg-sidebar-accent" />
                <div className="h-7 animate-pulse rounded-md bg-sidebar-accent/70" />
              </div>
            )}

            {!isLoading && data?.projects.length === 0 && (
              <button
                className="min-h-11 w-full rounded-md px-2 text-left text-sidebar-foreground/60 text-xs hover:bg-sidebar-accent hover:text-sidebar-foreground"
                onClick={() => setCreateOpen(true)}
                type="button"
              >
                Create a project to share files across conversations.
              </button>
            )}

            {data?.projects.map((project) => {
              const isOpen = openProjects.has(project.id);
              const isActive = activeProjectId === project.id;
              return (
                <SidebarMenuItem key={project.id}>
                  <div className="flex items-center">
                    <button
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? "Collapse" : "Expand"} ${project.name}`}
                      className="relative flex size-8 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/60 after:absolute after:-inset-y-1 after:-right-1 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring md:size-7"
                      onClick={() =>
                        setOpenProjects((current) => {
                          const next = new Set(current);
                          if (next.has(project.id)) {
                            next.delete(project.id);
                          } else {
                            next.add(project.id);
                          }
                          return next;
                        })
                      }
                      type="button"
                    >
                      {isOpen ? (
                        <ChevronDown className="size-3.5" />
                      ) : (
                        <ChevronRight className="size-3.5" />
                      )}
                    </button>
                    <SidebarMenuButton
                      asChild
                      className="min-h-11 flex-1 px-1 md:min-h-8"
                      isActive={isActive}
                    >
                      <Link
                        href={`/projects/${project.id}`}
                        onClick={() => setOpenMobile(false)}
                      >
                        <Folder />
                        <span>{project.name}</span>
                      </Link>
                    </SidebarMenuButton>
                  </div>

                  {isOpen && (
                    <ul className="ml-7 flex min-w-0 flex-col gap-0.5 border-sidebar-border border-l pl-2">
                      {project.recentChats.map((chat) => (
                        <li key={chat.id}>
                          <Link
                            aria-current={
                              chat.id === activeChatId ? "page" : undefined
                            }
                            className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sidebar-foreground/70 text-xs hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground md:min-h-7"
                            data-active={chat.id === activeChatId}
                            href={`/chat/${chat.id}`}
                            onClick={() => setOpenMobile(false)}
                          >
                            <MessageSquare className="size-3.5 shrink-0" />
                            <span className="truncate">{chat.title}</span>
                          </Link>
                        </li>
                      ))}
                      <li>
                        <button
                          className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-sidebar-foreground/60 text-xs hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring md:min-h-7"
                          onClick={async () => {
                            const response = await fetch(
                              `/api/projects/${project.id}/chats`,
                              { method: "POST" }
                            );
                            if (!response.ok) {
                              toast({
                                type: "error",
                                description:
                                  "We couldn't create the conversation. Please try again.",
                              });
                              return;
                            }
                            const result = (await response.json()) as {
                              chatId: string;
                            };
                            await mutate();
                            setOpenMobile(false);
                            router.push(`/chat/${result.chatId}`);
                            router.refresh();
                          }}
                          type="button"
                        >
                          <Plus className="size-3.5" />
                          New chat
                        </button>
                      </li>
                    </ul>
                  )}
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <Dialog onOpenChange={setCreateOpen} open={createOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create project</DialogTitle>
            <DialogDescription>
              Project files become searchable in every conversation inside the
              project.
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="Project name"
            autoFocus
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                createProject();
              }
            }}
            placeholder="Project name"
            value={name}
          />
          <DialogFooter>
            <Button onClick={() => setCreateOpen(false)} variant="outline">
              Keep browsing
            </Button>
            <Button disabled={!name.trim() || creating} onClick={createProject}>
              {creating ? "Creating project…" : "Create project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
