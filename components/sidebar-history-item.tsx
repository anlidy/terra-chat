import { FolderInput } from "lucide-react";
import Link from "next/link";
import { memo, useState } from "react";
import useSWR from "swr";
import type { Chat, Project } from "@/lib/db/schema";
import { fetcher } from "@/lib/utils";
import { MoreHorizontalIcon, PencilEditIcon, TrashIcon } from "./icons";
import { toast } from "./toast";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Input } from "./ui/input";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "./ui/sidebar";

const PureChatItem = ({
  chat,
  isActive,
  onDelete,
  setOpenMobile,
}: {
  chat: Chat;
  isActive: boolean;
  onDelete: (chatId: string) => void;
  setOpenMobile: (open: boolean) => void;
}) => {
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [newTitle, setNewTitle] = useState(chat.title);
  const [isRenaming, setIsRenaming] = useState(false);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const { data: projectsData } = useSWR<{ projects: Project[] }>(
    showMoveDialog ? "/api/projects" : null,
    fetcher
  );

  const handleRename = async () => {
    if (!newTitle.trim() || newTitle === chat.title) {
      setShowRenameDialog(false);
      return;
    }

    setIsRenaming(true);

    try {
      const response = await fetch("/api/chat", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: chat.id,
          title: newTitle.trim(),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to rename chat");
      }

      toast({
        type: "success",
        description: "Chat renamed successfully",
      });

      // Refresh the page to update the chat list
      window.location.reload();
    } catch (_error) {
      toast({
        type: "error",
        description: "Failed to rename chat",
      });
    } finally {
      setIsRenaming(false);
      setShowRenameDialog(false);
    }
  };

  const moveChat = async (projectId: string | null) => {
    setIsMoving(true);
    try {
      const response = await fetch(`/api/chats/${chat.id}/project`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!response.ok) {
        throw new Error("Failed to move chat");
      }
      toast({
        type: "success",
        description: projectId
          ? "Chat moved to project"
          : "Chat moved to independent chats",
      });
      setShowMoveDialog(false);
      window.location.reload();
    } catch (_error) {
      toast({ type: "error", description: "Failed to move chat" });
    } finally {
      setIsMoving(false);
    }
  };

  return (
    <>
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={isActive}>
          <Link href={`/chat/${chat.id}`} onClick={() => setOpenMobile(false)}>
            <span>{chat.title}</span>
          </Link>
        </SidebarMenuButton>

        <DropdownMenu modal={true}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuAction
              className="mr-0.5 cursor-pointer data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              showOnHover={!isActive}
            >
              <MoreHorizontalIcon />
              <span className="sr-only">More</span>
            </SidebarMenuAction>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" side="bottom">
            <DropdownMenuItem
              className="cursor-pointer"
              onSelect={() => {
                setNewTitle(chat.title);
                setShowRenameDialog(true);
              }}
            >
              <PencilEditIcon />
              <span>Rename</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer"
              onSelect={() => setShowMoveDialog(true)}
            >
              <FolderInput />
              <span>Move to project</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer text-destructive focus:bg-destructive/15 focus:text-destructive dark:text-red-500"
              onSelect={() => onDelete(chat.id)}
            >
              <TrashIcon />
              <span>Delete</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>

      <Dialog onOpenChange={setShowRenameDialog} open={showRenameDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Chat</DialogTitle>
            <DialogDescription>
              Enter a new title for this chat conversation.
            </DialogDescription>
          </DialogHeader>
          <Input
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleRename();
              }
            }}
            placeholder="Chat title"
            value={newTitle}
          />
          <DialogFooter>
            <Button
              disabled={isRenaming}
              onClick={() => setShowRenameDialog(false)}
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={isRenaming} onClick={handleRename}>
              {isRenaming ? "Renaming..." : "Rename"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={setShowMoveDialog} open={showMoveDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move chat</DialogTitle>
            <DialogDescription>
              Project chats can search that project's knowledge files. This
              chat's existing attachments stay with the chat.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {chat.projectId && (
              <Button
                className="min-h-11 w-full justify-start"
                disabled={isMoving}
                onClick={() => moveChat(null)}
                variant="ghost"
              >
                Independent chats
              </Button>
            )}
            {projectsData?.projects
              .filter((project) => project.id !== chat.projectId)
              .map((project) => (
                <Button
                  className="min-h-11 w-full justify-start"
                  disabled={isMoving}
                  key={project.id}
                  onClick={() => moveChat(project.id)}
                  variant="ghost"
                >
                  {project.name}
                </Button>
              ))}
            {projectsData?.projects.length === 0 && (
              <p className="py-6 text-center text-muted-foreground text-sm">
                Create a project before moving this chat.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setShowMoveDialog(false)} variant="outline">
              Keep chat here
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export const ChatItem = memo(PureChatItem, (prevProps, nextProps) => {
  if (prevProps.isActive !== nextProps.isActive) {
    return false;
  }
  return true;
});
