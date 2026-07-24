'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { Bell, CheckCheck, Loader2, UserPlus } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Notification } from '@/types';

type Response = { data: Notification[] };
const icons: Partial<Record<Notification['type'], typeof Bell>> = {
  conversation_assigned: UserPlus,
};

export default function NotificationsPage() {
  const router = useRouter();
  const { data, error, isLoading, mutate } = useSWR<Response>(
    '/api/v1/notifications'
  );
  const [markingAll, setMarkingAll] = useState(false);
  const notifications = data?.data ?? [];
  const unreadIds = notifications
    .filter((item) => !item.read_at)
    .map((item) => item.id);

  const markRead = useCallback(
    async (ids?: string[]) => {
      const response = await fetch('/api/v1/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!response.ok) throw new Error('Failed to mark notification as read');
      await mutate(await response.json(), { revalidate: false });
    },
    [mutate]
  );

  const handleClick = useCallback(
    async (notification: Notification) => {
      try {
        if (!notification.read_at) await markRead([notification.id]);
        if (notification.conversation_id)
          router.push(`/inbox?c=${notification.conversation_id}`);
      } catch {
        toast.error('Failed to mark notification as read');
      }
    },
    [markRead, router]
  );

  const markAllRead = useCallback(async () => {
    if (!unreadIds.length) return;
    setMarkingAll(true);
    try {
      await markRead();
    } catch {
      toast.error('Failed to mark all as read');
    } finally {
      setMarkingAll(false);
    }
  }, [markRead, unreadIds.length]);

  if (error)
    return (
      <div className="text-destructive flex h-64 items-center justify-center text-sm">
        Unable to load notifications.
      </div>
    );
  if (isLoading)
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-primary size-6 animate-spin" />
      </div>
    );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-foreground text-2xl font-bold">Notifications</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Conversations other teammates assign to you show up here.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!unreadIds.length || markingAll}
          onClick={markAllRead}
        >
          {markingAll ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <CheckCheck className="size-4" />
          )}{' '}
          Mark all as read
        </Button>
      </div>
      {!notifications.length ? (
        <div className="border-border bg-muted/40 flex h-48 flex-col items-center justify-center rounded-xl border border-dashed">
          <Bell className="text-primary size-6" />
          <p className="mt-3 text-sm font-medium">No notifications yet</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {notifications.map((notification) => {
            const Icon = icons[notification.type] ?? Bell;
            const unread = !notification.read_at;
            return (
              <li key={notification.id}>
                <button
                  type="button"
                  onClick={() => handleClick(notification)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors',
                    unread
                      ? 'border-primary/30 bg-primary/5 hover:border-primary/50'
                      : 'border-border bg-card hover:bg-muted/30'
                  )}
                >
                  <div
                    className={cn(
                      'flex size-10 shrink-0 items-center justify-center rounded-lg',
                      unread ? 'bg-primary/15' : 'bg-muted'
                    )}
                  >
                    <Icon
                      className={cn(
                        'size-5',
                        unread ? 'text-primary' : 'text-muted-foreground'
                      )}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'truncate text-sm font-semibold',
                          !unread && 'text-muted-foreground'
                        )}
                      >
                        {notification.title}
                      </span>
                      {unread && (
                        <span
                          aria-label="Unread"
                          className="bg-primary size-2 shrink-0 rounded-full"
                        />
                      )}
                    </div>
                    {notification.body && (
                      <p className="text-muted-foreground mt-0.5 truncate text-xs">
                        {notification.body}
                      </p>
                    )}
                    <p className="text-muted-foreground mt-1 text-xs">
                      {formatDistanceToNow(new Date(notification.created_at), {
                        addSuffix: true,
                      })}
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
