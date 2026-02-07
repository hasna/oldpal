import React from 'react';

type SidebarMockOptions = {
  getIsMobile?: () => boolean;
};

export function createSidebarMock(options: SidebarMockOptions = {}) {
  const getIsMobile = options.getIsMobile ?? (() => false);

  return {
    Sidebar: ({ children, ...props }: any) => React.createElement(
      'aside',
      { 'data-testid': 'sidebar', ...props },
      children
    ),
    SidebarContent: ({ children }: any) => React.createElement(
      'div',
      { 'data-testid': 'sidebar-content' },
      children
    ),
    SidebarFooter: ({ children }: any) => React.createElement(
      'footer',
      { 'data-testid': 'sidebar-footer' },
      children
    ),
    SidebarHeader: ({ children }: any) => React.createElement(
      'header',
      { 'data-testid': 'sidebar-header' },
      children
    ),
    SidebarProvider: ({ children }: any) => React.createElement(
      'div',
      { 'data-testid': 'sidebar-provider' },
      children
    ),
    SidebarInset: ({ children }: any) => React.createElement(
      'div',
      { 'data-testid': 'sidebar-inset' },
      children
    ),
    SidebarTrigger: ({ children, ...props }: any) => React.createElement(
      'button',
      { 'data-testid': 'sidebar-trigger', ...props },
      children || 'Toggle'
    ),
    SidebarGroup: ({ children, ...props }: any) => React.createElement(
      'div',
      { 'data-sidebar-group': true, ...props },
      children
    ),
    SidebarGroupContent: ({ children }: any) => React.createElement(
      'div',
      { 'data-sidebar-group-content': true },
      children
    ),
    SidebarGroupLabel: ({ children }: any) => React.createElement(
      'div',
      { 'data-sidebar-group-label': true },
      children
    ),
    SidebarMenu: ({ children }: any) => React.createElement(
      'nav',
      { 'data-sidebar-menu': true },
      children
    ),
    SidebarMenuAction: ({ children, className, showOnHover, ...props }: any) => React.createElement(
      'button',
      {
        'data-sidebar-menu-action': true,
        'data-show-on-hover': showOnHover,
        className,
        ...props,
      },
      children
    ),
    SidebarMenuButton: ({ children, tooltip, size, ...props }: any) => React.createElement(
      'button',
      {
        'data-sidebar-menu-button': true,
        'data-tooltip': tooltip,
        'data-size': size,
        ...props,
      },
      children
    ),
    SidebarMenuItem: ({ children }: any) => React.createElement(
      'div',
      { 'data-sidebar-menu-item': true },
      children
    ),
    SidebarMenuSub: ({ children }: any) => React.createElement(
      'div',
      { 'data-sidebar-menu-sub': true },
      children
    ),
    SidebarMenuSubButton: ({ children, ...props }: any) => React.createElement(
      'button',
      { 'data-sidebar-menu-sub-button': true, ...props },
      children
    ),
    SidebarMenuSubItem: ({ children }: any) => React.createElement(
      'div',
      { 'data-sidebar-menu-sub-item': true },
      children
    ),
    useSidebar: () => ({
      isMobile: getIsMobile(),
      state: 'expanded',
      open: true,
      setOpen: () => {},
      openMobile: false,
      setOpenMobile: () => {},
      toggleSidebar: () => {},
    }),
  };
}
