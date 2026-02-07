"use client"

import * as React from "react"
import {
  Bot,
  Clock,
  Command,
  CreditCard,
  Inbox,
  LifeBuoy,
  MessageSquare,
  Send,
  Settings2,
  History,
  Shield,
  Users,
  BarChart3,
  FileText,
  UserCircle,
  Wrench,
  Sparkles,
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
      tourId: "chat-link",
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
      title: "Assistants",
      url: "/assistants",
      icon: Bot,
      tourId: "assistants-link",
      items: [
        {
          title: "My Assistants",
          url: "/assistants",
        },
        {
          title: "Identities",
          url: "/identities",
        },
        {
          title: "Tools",
          url: "/tools",
        },
        {
          title: "Connectors",
          url: "/connectors",
        },
        {
          title: "Skills",
          url: "/skills",
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
      ],
    },
    {
      title: "Schedules",
      url: "/schedules",
      icon: Clock,
      tourId: "schedules-link",
      items: [
        {
          title: "All Schedules",
          url: "/schedules",
        },
      ],
    },
    {
      title: "Billing",
      url: "/billing",
      icon: CreditCard,
      items: [
        {
          title: "Subscription",
          url: "/billing",
        },
        {
          title: "Pricing",
          url: "/pricing",
        },
      ],
    },
    {
      title: "Settings",
      url: "/settings",
      icon: Settings2,
      tourId: "settings-link",
      items: [
        {
          title: "Profile",
          url: "/settings",
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
  navAdmin: [
    {
      title: "Admin",
      url: "/admin/stats",
      icon: Shield,
      items: [
        {
          title: "Stats",
          url: "/admin/stats",
        },
        {
          title: "Users",
          url: "/admin/users",
        },
        {
          title: "Audit Log",
          url: "/admin/audit",
        },
      ],
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
    <Sidebar variant="inset" aria-label="Main navigation" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <a href="/chat" aria-label="Assistants AI Platform - Go to chat">
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
        {user?.role === 'admin' && <NavMain items={data.navAdmin} />}
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={userData} />
      </SidebarFooter>
    </Sidebar>
  )
}
