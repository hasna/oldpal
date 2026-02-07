import React from 'react';

const iconNames = [
  'BadgeCheck',
  'BarChart3',
  'Bell',
  'Bot',
  'Check',
  'ChevronDown',
  'ChevronRight',
  'ChevronUp',
  'ChevronsUpDown',
  'Circle',
  'Clock',
  'Command',
  'CreditCard',
  'FileText',
  'Folder',
  'History',
  'Inbox',
  'LifeBuoy',
  'LogOut',
  'MessageSquare',
  'MoreHorizontal',
  'PanelLeft',
  'Send',
  'Settings2',
  'Share',
  'Shield',
  'Sparkles',
  'Trash2',
  'UserCircle',
  'Users',
  'Wrench',
  'X',
];

export function createLucideMock() {
  const icons: Record<string, unknown> = { __esModule: true };

  for (const name of iconNames) {
    icons[name] = () => React.createElement('span', { 'data-icon': name });
  }

  icons.default = icons;

  return icons;
}
