"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { User } from "next-auth";
import { PlusIcon, SidebarLeftIcon } from "@/components/icons";
import { ProjectSidebar } from "@/components/project-sidebar";
import { SidebarHistory } from "@/components/sidebar-history";
import { SidebarUserNav } from "@/components/sidebar-user-nav";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function AppSidebar({ user }: { user: User | undefined }) {
  const router = useRouter();
  const { setOpenMobile, toggleSidebar } = useSidebar();

  return (
    <Sidebar
      className="group-data-[side=left]:border-r-0"
      collapsible="icon"
      variant="sidebar"
    >
      <SidebarHeader className="px-2 pt-2 pb-1">
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center justify-between gap-2 px-1 group-data-[collapsible=icon]:justify-center">
              <Link
                className="flex min-w-0 flex-1 items-center gap-2 group-data-[collapsible=icon]:hidden"
                href="/"
                onClick={() => {
                  setOpenMobile(false);
                }}
              >
                <span className="rounded-md px-2 py-1 font-semibold text-lg text-sidebar-foreground transition-colors hover:bg-sidebar-accent">
                  Chatbot
                </span>
              </Link>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    className="size-8 shrink-0 rounded-lg text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground group-data-[collapsible=icon]:ml-0"
                    data-testid="sidebar-toggle-button"
                    onClick={toggleSidebar}
                    type="button"
                    variant="ghost"
                  >
                    <SidebarLeftIcon size={16} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent align="end" className="hidden md:block">
                  Toggle Sidebar
                </TooltipContent>
              </Tooltip>
            </div>
          </SidebarMenuItem>
          <SidebarMenuItem className="mt-2">
            <SidebarMenuButton
              className="group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:w-8"
              onClick={() => {
                setOpenMobile(false);
                router.push("/");
                router.refresh();
              }}
              tooltip="New Chat"
              type="button"
            >
              <PlusIcon />
              <span>New Chat</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="px-2 group-data-[collapsible=icon]:hidden">
        <ProjectSidebar user={user} />
        <SidebarHistory user={user} />
      </SidebarContent>
      <SidebarFooter className="mt-auto px-3 pb-3 group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-2">
        {user && <SidebarUserNav user={user} />}
      </SidebarFooter>
    </Sidebar>
  );
}
