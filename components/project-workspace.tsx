"use client";

import { formatDistanceToNow } from "date-fns";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  LoaderCircle,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Presentation,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import type { Chat, Project } from "@/lib/db/schema";
import { fetcher } from "@/lib/utils";
import { PROJECTS_CACHE_KEY } from "./project-sidebar";
import { SidebarToggle } from "./sidebar-toggle";
import { toast } from "./toast";

type ProjectResource = {
  id: string;
  fileName: string;
  fileType: string;
  mimeType: string;
  fileSize: number;
  status: string;
  errorMessage: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  progress: number | null;
};

type ProjectData = {
  project: Project;
  chats: Chat[];
  resources: ProjectResource[];
};

const ACCEPTED_DOCUMENTS = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
].join(",");

function isProcessing(status: string) {
  return ["queued", "parsing", "chunking", "embedding", "indexing"].includes(
    status
  );
}

function formatFileSize(size: number) {
  if (size === 0) {
    return "Legacy file";
  }
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function FileIcon({ type }: { type: string }) {
  if (type === "xlsx") {
    return <FileSpreadsheet className="size-4 text-emerald-600" />;
  }
  if (type === "pptx") {
    return <Presentation className="size-4 text-amber-600" />;
  }
  return <FileText className="size-4 text-red-600" />;
}

function ResourceStatus({ resource }: { resource: ProjectResource }) {
  if (resource.status === "ready") {
    return (
      <Badge
        className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
        variant="outline"
      >
        <CheckCircle2 className="size-3" /> Ready
      </Badge>
    );
  }
  if (["failed", "cancelled"].includes(resource.status)) {
    return (
      <Badge className="gap-1" variant="destructive">
        <AlertCircle className="size-3" />
        {resource.status === "cancelled" ? "Cancelled" : "Failed"}
      </Badge>
    );
  }
  return (
    <Badge className="gap-1" variant="secondary">
      <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" />
      {resource.status === "queued" ? "Queued" : "Processing"}
    </Badge>
  );
}

export function ProjectWorkspace({
  projectId,
  initialData,
}: {
  projectId: string;
  initialData: ProjectData;
}) {
  const router = useRouter();
  const { mutate: mutateGlobal } = useSWRConfig();
  const cacheKey = `/api/projects/${projectId}`;
  const { data = initialData, mutate } = useSWR<ProjectData>(
    cacheKey,
    fetcher,
    {
      fallbackData: initialData,
      refreshInterval: (currentData) =>
        currentData?.resources.some((resource) => isProcessing(resource.status))
          ? 2000
          : 0,
    }
  );
  const [activeTab, setActiveTab] = useState<"chats" | "knowledge">("chats");
  const [uploading, setUploading] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [resourceToDelete, setResourceToDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [projectName, setProjectName] = useState(data.project.name);
  const [savingName, setSavingName] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const createChat = async () => {
    const response = await fetch(`/api/projects/${projectId}/chats`, {
      method: "POST",
    });
    if (!response.ok) {
      toast({
        type: "error",
        description: "We couldn't create the conversation. Please try again.",
      });
      return;
    }
    const result = (await response.json()) as { chatId: string };
    await Promise.all([mutate(), mutateGlobal(PROJECTS_CACHE_KEY)]);
    router.push(`/chat/${result.chatId}`);
    router.refresh();
  };

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) {
      return;
    }
    setUploading(true);
    try {
      const results = await Promise.allSettled(
        files.map(async (file) => {
          const form = new FormData();
          form.append("file", file);
          form.append("projectId", projectId);
          const response = await fetch("/api/files/upload", {
            method: "POST",
            body: form,
          });
          if (!response.ok) {
            const body = (await response.json().catch(() => ({}))) as {
              error?: string;
            };
            throw new Error(body.error ?? `Upload failed for ${file.name}`);
          }
        })
      );
      const failures = results.filter((result) => result.status === "rejected");
      await mutate();
      if (failures.length > 0) {
        throw new Error(
          `${failures.length} ${failures.length === 1 ? "file" : "files"} could not be uploaded.`
        );
      }
      toast({
        type: "success",
        description: `${files.length} ${files.length === 1 ? "file is" : "files are"} being added to project knowledge.`,
      });
    } catch (error) {
      toast({
        type: "error",
        description:
          error instanceof Error ? error.message : "File upload failed.",
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const renameProject = async () => {
    const name = projectName.trim();
    if (!name) {
      return;
    }
    setSavingName(true);
    try {
      const response = await fetch(cacheKey, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) {
        throw new Error("We couldn't rename the project. Please try again.");
      }
      await Promise.all([mutate(), mutateGlobal(PROJECTS_CACHE_KEY)]);
      setRenameOpen(false);
    } catch (error) {
      toast({
        type: "error",
        description:
          error instanceof Error ? error.message : "Project rename failed.",
      });
    } finally {
      setSavingName(false);
    }
  };

  const deleteProject = async () => {
    const response = await fetch(cacheKey, { method: "DELETE" });
    if (!response.ok) {
      toast({
        type: "error",
        description: "We couldn't delete the project. Please try again.",
      });
      return;
    }
    await mutateGlobal(PROJECTS_CACHE_KEY);
    router.replace("/");
    router.refresh();
  };

  const deleteResource = async () => {
    if (!resourceToDelete) {
      return;
    }
    const response = await fetch(`/api/resources/${resourceToDelete.id}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      toast({
        type: "error",
        description: "The file could not be deleted.",
      });
      return;
    }
    setResourceToDelete(null);
    await mutate();
  };

  const readyResources = data.resources.filter(
    (resource) => resource.status === "ready"
  );

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex min-h-14 max-w-6xl items-center gap-3 px-4 md:px-6">
          <SidebarToggle className="size-11 px-0 md:hidden" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-semibold text-base">
              {data.project.name}
            </h1>
            <p className="text-muted-foreground text-xs">
              {data.chats.length} {data.chats.length === 1 ? "chat" : "chats"}
              {" · "}
              {readyResources.length} searchable files
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="Project actions"
                className="size-11 md:size-9"
                variant="ghost"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
                Rename project
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => setDeleteOpen(true)}
              >
                Delete project
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <nav
          aria-label="Project sections"
          className="mx-auto flex max-w-6xl gap-6 px-4 md:px-6"
        >
          {(["chats", "knowledge"] as const).map((tab) => (
            <button
              aria-current={activeTab === tab ? "page" : undefined}
              className="relative min-h-11 capitalize text-sm after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:scale-x-0 after:bg-foreground after:transition-transform aria-[current=page]:font-medium aria-[current=page]:after:scale-x-100"
              key={tab}
              onClick={() => setActiveTab(tab)}
              type="button"
            >
              {tab}
            </button>
          ))}
        </nav>
      </header>

      <input
        accept={ACCEPTED_DOCUMENTS}
        className="sr-only"
        multiple
        onChange={(event) => uploadFiles(Array.from(event.target.files ?? []))}
        ref={fileInputRef}
        type="file"
      />

      <main className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">
        {activeTab === "chats" ? (
          <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <section aria-labelledby="recent-chats-heading">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <h2
                    className="font-semibold text-lg"
                    id="recent-chats-heading"
                  >
                    Recent chats
                  </h2>
                  <p className="mt-1 text-muted-foreground text-sm">
                    Every chat can search this project's ready files.
                  </p>
                </div>
                <Button
                  className="min-h-11 shrink-0 md:min-h-9"
                  onClick={createChat}
                >
                  <Plus className="size-4" /> New chat
                </Button>
              </div>

              {data.chats.length === 0 ? (
                <div className="border-y py-12 text-center">
                  <MessageSquare className="mx-auto size-6 text-muted-foreground" />
                  <h3 className="mt-3 font-medium">No project chats yet</h3>
                  <p className="mx-auto mt-1 max-w-md text-muted-foreground text-sm">
                    Start a conversation to ask questions across the files in
                    this project's knowledge library.
                  </p>
                  <Button className="mt-5 min-h-11" onClick={createChat}>
                    Create first chat
                  </Button>
                </div>
              ) : (
                <div className="divide-y border-y">
                  {data.chats.map((chat) => (
                    <div
                      className="group flex min-h-16 items-center gap-1"
                      key={chat.id}
                    >
                      <Link
                        className="flex min-w-0 flex-1 items-center gap-3 px-1 py-3 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        href={`/chat/${chat.id}`}
                      >
                        <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-sm">
                            {chat.title}
                          </p>
                          <p className="mt-1 text-muted-foreground text-xs">
                            {formatDistanceToNow(new Date(chat.createdAt), {
                              addSuffix: true,
                            })}
                          </p>
                        </div>
                        <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
                      </Link>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            aria-label={`Actions for ${chat.title}`}
                            className="size-11 md:size-9"
                            variant="ghost"
                          >
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={async () => {
                              const response = await fetch(
                                `/api/chats/${chat.id}/project`,
                                {
                                  method: "PATCH",
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                  body: JSON.stringify({ projectId: null }),
                                }
                              );
                              if (!response.ok) {
                                toast({
                                  type: "error",
                                  description: "The chat could not be moved.",
                                });
                                return;
                              }
                              await Promise.all([
                                mutate(),
                                mutateGlobal(PROJECTS_CACHE_KEY),
                              ]);
                            }}
                          >
                            Move to independent chats
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <aside
              aria-labelledby="knowledge-summary-heading"
              className="xl:border-l xl:pl-8"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2
                    className="font-semibold text-base"
                    id="knowledge-summary-heading"
                  >
                    Knowledge
                  </h2>
                  <p className="mt-1 text-muted-foreground text-xs">
                    {readyResources.length} of {data.resources.length} files
                    ready
                  </p>
                </div>
                <Button
                  className="min-h-11 md:min-h-9"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                  size="sm"
                  variant="outline"
                >
                  <Upload className="size-4" />
                  {uploading ? "Uploading…" : "Upload files"}
                </Button>
              </div>
              <div className="mt-4 divide-y border-y">
                {data.resources.slice(0, 6).map((resource) => (
                  <div
                    className="flex min-h-14 items-center gap-3 py-2"
                    key={resource.id}
                  >
                    <FileIcon type={resource.fileType} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{resource.fileName}</p>
                      <p className="mt-0.5 text-muted-foreground text-xs">
                        {formatFileSize(resource.fileSize)}
                      </p>
                    </div>
                    <ResourceStatus resource={resource} />
                  </div>
                ))}
                {data.resources.length === 0 && (
                  <button
                    className="min-h-20 w-full text-left text-muted-foreground text-sm hover:text-foreground"
                    onClick={() => fileInputRef.current?.click()}
                    type="button"
                  >
                    Upload project files so every chat can use the same context.
                  </button>
                )}
              </div>
              {data.resources.length > 6 && (
                <Button
                  className="mt-2 px-0"
                  onClick={() => setActiveTab("knowledge")}
                  variant="link"
                >
                  View all files
                </Button>
              )}
            </aside>
          </div>
        ) : (
          <section aria-labelledby="knowledge-heading">
            <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="font-semibold text-lg" id="knowledge-heading">
                  Project knowledge
                </h2>
                <p className="mt-1 max-w-2xl text-muted-foreground text-sm">
                  Ready files are searched automatically in every project chat.
                  PDF, DOCX, XLSX, PPTX, and TXT files up to 20 MB are
                  supported.
                </p>
              </div>
              <Button
                className="min-h-11 shrink-0"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="size-4" />
                {uploading ? "Uploading files…" : "Upload files"}
              </Button>
            </div>

            {data.resources.length === 0 ? (
              <div className="border-y py-14 text-center">
                <FileText className="mx-auto size-7 text-muted-foreground" />
                <h3 className="mt-3 font-medium">No knowledge files yet</h3>
                <p className="mx-auto mt-1 max-w-md text-muted-foreground text-sm">
                  Add source material once, then use it across every
                  conversation in this project.
                </p>
                <Button
                  className="mt-5 min-h-11"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Upload first files
                </Button>
              </div>
            ) : (
              <div className="divide-y border-y">
                {data.resources.map((resource) => (
                  <div
                    className="grid min-h-16 items-center gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_8rem_8rem_6rem]"
                    key={resource.id}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <FileIcon type={resource.fileType} />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-sm">
                          {resource.fileName}
                        </p>
                        <p className="mt-0.5 text-muted-foreground text-xs sm:hidden">
                          {formatFileSize(resource.fileSize)} ·{" "}
                          {resource.fileType.toUpperCase()}
                        </p>
                      </div>
                    </div>
                    <p className="hidden text-muted-foreground text-sm sm:block">
                      {resource.fileType.toUpperCase()} ·{" "}
                      {formatFileSize(resource.fileSize)}
                    </p>
                    <div>
                      <ResourceStatus resource={resource} />
                      {isProcessing(resource.status) && (
                        <Progress
                          className="mt-2 h-1"
                          value={resource.progress ?? 0}
                        />
                      )}
                    </div>
                    <div className="flex min-h-11 items-center justify-end gap-1">
                      {resource.status === "failed" && (
                        <Button
                          aria-label={`Retry ${resource.fileName}`}
                          className="size-11 sm:size-9"
                          onClick={async () => {
                            const response = await fetch(
                              `/api/resources/${resource.id}/retry`,
                              { method: "POST" }
                            );
                            if (response.ok) {
                              await mutate();
                            } else {
                              toast({
                                type: "error",
                                description: "Retry could not be started.",
                              });
                            }
                          }}
                          variant="ghost"
                        >
                          <RefreshCw className="size-4" />
                        </Button>
                      )}
                      <Button
                        aria-label={`Delete ${resource.fileName}`}
                        className="size-11 text-muted-foreground hover:text-destructive sm:size-9"
                        onClick={() =>
                          setResourceToDelete({
                            id: resource.id,
                            name: resource.fileName,
                          })
                        }
                        variant="ghost"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                    {resource.status === "failed" && resource.errorMessage && (
                      <p className="text-destructive text-xs sm:col-span-4">
                        {resource.errorMessage} Retry the file or delete it from
                        the project.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      <Dialog onOpenChange={setRenameOpen} open={renameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
            <DialogDescription>
              Choose a name that makes this workspace easy to find.
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="Project name"
            maxLength={120}
            onChange={(event) => setProjectName(event.target.value)}
            value={projectName}
          />
          <DialogFooter>
            <Button onClick={() => setRenameOpen(false)} variant="outline">
              Keep current name
            </Button>
            <Button
              disabled={!projectName.trim() || savingName}
              onClick={renameProject}
            >
              {savingName ? "Saving name…" : "Save name"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog onOpenChange={setDeleteOpen} open={deleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{data.project.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Project files and their search index will be permanently deleted.
              Project chats will return to your independent chat history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep project</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={deleteProject}
            >
              Delete project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        onOpenChange={(open) => !open && setResourceToDelete(null)}
        open={resourceToDelete !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete “{resourceToDelete?.name}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This file and its search index will be permanently removed from
              the project knowledge library.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep file</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={deleteResource}
            >
              Delete file
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
