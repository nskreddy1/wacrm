'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bot,
  Building2,
  LifeBuoy,
  Radio,
  SlidersHorizontal,
} from 'lucide-react';

import { cn } from '@/lib/utils';

const items = [
  { href: '/admin/workspaces', label: 'Workspaces', icon: Building2 },
  { href: '/admin/tickets', label: 'Tickets', icon: LifeBuoy },
  { href: '/admin/channels', label: 'Channels', icon: Radio },
  { href: '/admin/ai-agent', label: 'AI Agent', icon: Bot },
  { href: '/admin/platform', label: 'Platform', icon: SlidersHorizontal },
] as const;

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin console sections">
      <ul className="bg-card flex flex-wrap items-center gap-1 rounded-lg border p-1">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
