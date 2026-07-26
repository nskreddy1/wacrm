'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bot,
  Building2,
  CreditCard,
  LifeBuoy,
  Radio,
  SlidersHorizontal,
} from 'lucide-react';

import { cn } from '@/lib/utils';

// ============================================================
// Admin console sidebar.
//
// Design notes (Emil Kowalski's design-engineering principles):
// - Transitions name exact properties (color, background-color,
//   transform) — never `transition: all`.
// - Navigation is a keyboard/hundreds-of-times surface: the active
//   indicator moves without entrance animation; only hover/press
//   feedback animates, at 150ms with a strong ease-out curve.
// - Press feedback: scale(0.98) on :active so the control visibly
//   responds to the pointer.
// - Hover styles are gated behind (hover:hover) via Tailwind's
//   default `hover:` variant behavior on touch devices remaining
//   acceptable because color-only changes are non-disruptive.
// ============================================================

// Providers is intentionally absent: it is a standalone page with
// its own sidebar entry, not a console tab.
const items = [
  { href: '/admin/workspaces', label: 'Workspaces', icon: Building2 },
  { href: '/admin/plans', label: 'Plans & Billing', icon: CreditCard },
  { href: '/admin/tickets', label: 'Tickets', icon: LifeBuoy },
  { href: '/admin/channels', label: 'Channels', icon: Radio },
  { href: '/admin/ai-agent', label: 'AI Agent', icon: Bot },
  { href: '/admin/platform', label: 'Platform', icon: SlidersHorizontal },
] as const;

export function AdminSidebar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Admin console sections"
      className="md:w-52 md:shrink-0"
    >
      {/* Mobile: horizontal scroll strip. Desktop: vertical rail. */}
      <ul className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href} className="shrink-0 md:shrink">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium',
                  'transition-[color,background-color,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]',
                  'active:scale-[0.98]',
                  active
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                )}
              >
                {/* Active rail marker — desktop only; position is
                    instant (no entrance animation) because section
                    switching is a high-frequency action. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    'bg-primary absolute top-1/2 left-0 hidden h-4 w-0.5 -translate-y-1/2 rounded-full md:block',
                    active ? 'opacity-100' : 'opacity-0'
                  )}
                />
                <Icon
                  className={cn(
                    'size-4 transition-colors duration-150',
                    active ? 'text-primary' : 'text-muted-foreground/70 group-hover:text-foreground'
                  )}
                  aria-hidden="true"
                />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
