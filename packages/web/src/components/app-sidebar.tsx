"use client"

import * as React from "react"
import {
  Bot,
  Command,
  Inbox,
  LifeBuoy,
  MessageSquare,
  Send,
  Settings2,
  SquareTerminal,
  History,
  Users,
} from "lucide-react"

import { NavMain } from "@/components/nav-main"
import { NavProjects } from "@/components/nav-projects"
import { NavSecondary } from "@/components/nav-secondary"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { useAuthStore } from "@/hooks/use-auth"

const data = {
  navMain: [
    {
      title: "Chat",
      url: "/chat",
      icon: MessageSquare,
      isActive: true,
      items: [
        {
          title: "New Chat",
          url: "/chat",
        },
        {
          title: "History",
          url: "/sessions",
        },
      ],
    },
    {
      title: "Agents",
      url: "/agents",
      icon: Bot,
      items: [
        {
          title: "My Agents",
          url: "/agents",
        },
        {
          title: "Create Agent",
          url: "/agents/new",
        },
      ],
    },
    {
      title: "Messages",
      url: "/messages",
      icon: Inbox,
      items: [
        {
          title: "Inbox",
          url: "/messages",
        },
        {
          title: "Sent",
          url: "/messages?filter=sent",
        },
      ],
    },
    {
      title: "Settings",
      url: "/settings",
      icon: Settings2,
      items: [
        {
          title: "Profile",
          url: "/settings",
        },
        {
          title: "API Keys",
          url: "/settings/api-keys",
        },
      ],
    },
  ],
  navSecondary: [
    {
      title: "Support",
      url: "#",
      icon: LifeBuoy,
    },
    {
      title: "Feedback",
      url: "#",
      icon: Send,
    },
  ],
  sessions: [
    {
      name: "Recent Sessions",
      url: "/sessions",
      icon: History,
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { user } = useAuthStore()

  const userData = {
    name: user?.name || "Guest",
    email: user?.email || "",
    avatar: user?.avatarUrl || "",
  }

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <a href="/chat">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <Command className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Assistants</span>
                  <span className="truncate text-xs">AI Platform</span>
                </div>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={userData} />
      </SidebarFooter>
    </Sidebar>
  )
}
