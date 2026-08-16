'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Hash, MessageSquare, Plus, Search, Users, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { usePresence } from '@/features/presence/hooks/use-presence';
import {
  useTeamChat,
  type TeamMessage,
} from '@/features/team-chat/hooks/use-team-chat';
import { useChatNotificationPrefs } from '@/features/team-chat/hooks/use-chat-notification-prefs';
import {
  armNotificationSound,
  playNotificationSound,
} from '@/features/team-chat/lib/notification-sound';

/** Toast-level mute span. See the `cancel` handler for why it is 7 days. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
import { useSelfPresence } from '@/features/presence/components/presence-provider';
import { presenceLabel } from '@/features/presence/lib/presence';
import { PresenceDot } from '@/features/presence/components/presence-dot';
import { cn } from '@/lib/utils';

import { TeamChatConversation } from './team-chat-conversation';
import { TeamChatCreateChannel } from './team-chat-create-channel';
import { MemberAvatar } from './member-avatar';

type Tab = 'chats' | 'contacts';

/**
 * Floating team-chat launcher + slide-up panel (Bigin/Slack style).
 * Mounted once in the dashboard shell so it's available on every page.
 */
export function TeamChatWidget() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('chats');
  const [query, setQuery] = useState('');
  const [channelDialogOpen, setChannelDialogOpen] = useState(false);

  const { user, profile } = useAuth();
  // Always enabled — NOT gated on `open`. The launcher shows an unread
  // badge and we raise toasts while the panel is closed, so both need the
  // conversation snapshot and the realtime subscription live at all times.
  // (Gating this on `open` meant totalUnread was pinned at 0 whenever the
  // panel was shut, so the closed-state badge could never appear.)
  const { canPopup, muteConversation } = useChatNotificationPrefs();

  // `openRef` mirrors `open` for the async realtime callback below. Reading
  // `open` directly there would capture the value from the render that
  // created the handler, so a toast could be suppressed for a panel the
  // user had since closed.
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // Bind the gesture listeners that unlock audio. Must happen well before
  // the first message arrives, so it runs on mount rather than lazily at
  // play time — by then the gesture requirement can no longer be met.
  useEffect(() => {
    armNotificationSound();
  }, []);

  // Chat is read inside a callback that must be passed *into* useTeamChat,
  // so a ref breaks the cycle. Safe because the callback only ever runs
  // later, from a realtime event — never during this render.
  const chatRef = useRef<ReturnType<typeof useTeamChat> | null>(null);

  const handleIncoming = useCallback(
    (msg: TeamMessage, isActiveThread: boolean) => {
      // Already on screen in the open panel — a popup would be noise.
      if (isActiveThread && openRef.current) return;
      if (!canPopup(msg.conversation_id)) return;

      const c = chatRef.current;
      const conv = c?.conversations.find((x) => x.id === msg.conversation_id);
      const sender = c?.memberById.get(msg.sender_id);
      // Prefer the real person's name; fall back to the thread title so a
      // channel message never announces itself as "Someone".
      const title =
        sender?.full_name ??
        (conv ? c?.describeConversation(conv).title : null) ??
        'New message';

      // Sound rides the same gate as the popup, so muting a thread
      // silences it too. No-ops until the user has interacted with the
      // page at least once — see notification-sound.ts.
      playNotificationSound();

      toast(title, {
        description: msg.body.slice(0, 120),
        action: {
          label: 'Reply',
          onClick: () => {
            setOpen(true);
            void chatRef.current?.openConversation(msg.conversation_id);
          },
        },
        cancel: {
          // A week, not forever: the toast is a snap decision made while
          // busy, and an accidental permanent mute is the kind of thing
          // nobody discovers until they have missed something. Permanent
          // muting stays available from the conversation itself.
          label: 'Mute 7 days',
          onClick: () => void muteConversation(msg.conversation_id, WEEK_MS),
        },
      });
    },
    [canPopup, muteConversation]
  );

  const chat = useTeamChat(true, handleIncoming);
  useEffect(() => {
    chatRef.current = chat;
  });
  // Presence stays gated: the roster is only rendered inside the open
  // panel, and each consumer costs its own channel + full roster fetch.
  const { getPresence, getRow, now } = usePresence(open);

  const filteredConversations = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chat.conversations;
    return chat.conversations.filter((c) =>
      chat.describeConversation(c).title.toLowerCase().includes(q)
    );
  }, [chat, query]);

  const filteredMembers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chat.members;
    return chat.members.filter(
      (m) =>
        m.full_name.toLowerCase().includes(q) ||
        (m.email ?? '').toLowerCase().includes(q)
    );
  }, [chat.members, query]);

  const active = chat.activeId
    ? (chat.conversations.find((c) => c.id === chat.activeId) ?? null)
    : null;

  // Self status comes from the writer, NOT from getPresence(user.id).
  // The roster is a round-trip behind (and is only fetched while the panel
  // is open), so reading my own row there let the widget claim "Online"
  // while the avatar menu already said "Away". One source of truth.
  const myPresence = useSelfPresence();

  return (
    <>
      {/* Launcher — a labelled pill rather than a bare circle. Mira now
          owns the right edge as a vertical tab, so this is the only
          bottom-corner control; naming it removes the guesswork two
          identical icon circles used to create.

          Unlike Mira's tab this stays mounted while open, because the
          panel's list view has no close button of its own — this pill
          is how the user dismisses it. */}
      <Button
        type="button"
        aria-label={open ? 'Close team chat' : 'Open team chat'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="fixed right-4 bottom-4 z-40 h-11 gap-2 rounded-full px-4 shadow-lg"
      >
        {open ? (
          <X className="size-4" aria-hidden />
        ) : (
          <MessageSquare className="size-4" aria-hidden />
        )}
        <span className="text-sm font-semibold">Team chats</span>
        {!open && chat.totalUnread > 0 && (
          <span className="bg-destructive text-destructive-foreground absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-semibold">
            {chat.totalUnread > 99 ? '99+' : chat.totalUnread}
          </span>
        )}
      </Button>

      {/* Panel */}
      {open && (
        <section
          aria-label="Team chat"
          className="bg-background fixed right-4 bottom-20 z-40 flex h-[min(560px,calc(100dvh-7rem))] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border shadow-2xl"
        >
          {active ? (
            <TeamChatConversation
              conversation={active}
              chat={chat}
              getPresence={getPresence}
              getRow={getRow}
              now={now}
            />
          ) : (
            <>
              {/* Header: me + status */}
              <header className="flex items-center gap-3 border-b px-4 py-3">
                <div className="relative">
                  <MemberAvatar
                    name={profile?.full_name ?? 'Me'}
                    avatarUrl={profile?.avatar_url ?? null}
                    className="size-9"
                  />
                  <PresenceDot
                    status={myPresence}
                    className="ring-background absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {profile?.full_name ?? 'Me'}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {presenceLabel(
                      myPresence,
                      getRow(user?.id ?? '')?.last_seen_at,
                      now
                    )}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="New channel"
                  onClick={() => setChannelDialogOpen(true)}
                >
                  <Plus />
                </Button>
              </header>

              {/* Search */}
              <div className="border-b px-3 py-2">
                <div className="relative">
                  <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search contacts & chats"
                    className="h-9 pl-8"
                    aria-label="Search contacts and chats"
                  />
                </div>
              </div>

              {/* Body */}
              <div className="min-h-0 flex-1 overflow-y-auto">
                {tab === 'chats' ? (
                  filteredConversations.length === 0 ? (
                    <EmptyState />
                  ) : (
                    <ul className="flex flex-col">
                      {filteredConversations.map((conv) => {
                        const { title, dmUserId } =
                          chat.describeConversation(conv);
                        const unreadCount = chat.unread.get(conv.id) ?? 0;
                        return (
                          <li key={conv.id}>
                            <button
                              type="button"
                              onClick={() =>
                                void chat.openConversation(conv.id)
                              }
                              className="hover:bg-muted flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors"
                            >
                              {conv.kind === 'channel' ? (
                                <span className="bg-muted flex size-9 shrink-0 items-center justify-center rounded-full">
                                  <Hash className="text-muted-foreground size-4" />
                                </span>
                              ) : (
                                <div className="relative shrink-0">
                                  <MemberAvatar
                                    name={title}
                                    avatarUrl={
                                      dmUserId
                                        ? (chat.memberById.get(dmUserId)
                                            ?.avatar_url ?? null)
                                        : null
                                    }
                                    className="size-9"
                                  />
                                  {dmUserId && (
                                    <PresenceDot
                                      status={getPresence(dmUserId)}
                                      className="ring-background absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2"
                                    />
                                  )}
                                </div>
                              )}
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">
                                  {title}
                                </span>
                                <span className="text-muted-foreground block truncate text-xs">
                                  {conv.last_message_text ?? 'No messages yet'}
                                </span>
                              </span>
                              {unreadCount > 0 && (
                                <span className="bg-primary text-primary-foreground flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-semibold">
                                  {unreadCount > 99 ? '99+' : unreadCount}
                                </span>
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )
                ) : (
                  <ul className="flex flex-col">
                    {filteredMembers.length === 0 ? (
                      <p className="text-muted-foreground px-4 py-8 text-center text-sm">
                        No teammates found.
                      </p>
                    ) : (
                      filteredMembers.map((member) => (
                        <li key={member.user_id}>
                          <button
                            type="button"
                            onClick={() => void chat.openDm(member.user_id)}
                            className="hover:bg-muted flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors"
                          >
                            <div className="relative shrink-0">
                              <MemberAvatar
                                name={member.full_name || member.email || '?'}
                                avatarUrl={member.avatar_url}
                                className="size-9"
                              />
                              <PresenceDot
                                status={getPresence(member.user_id)}
                                className="ring-background absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2"
                              />
                            </div>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">
                                {member.full_name || member.email}
                              </span>
                              <span className="text-muted-foreground block truncate text-xs">
                                {presenceLabel(
                                  getPresence(member.user_id),
                                  getRow(member.user_id)?.last_seen_at,
                                  now
                                )}
                              </span>
                            </span>
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </div>

              {/* Tabs */}
              <nav
                className="grid grid-cols-2 border-t"
                aria-label="Chat sections"
              >
                <TabButton
                  label="Chats"
                  icon={<MessageSquare className="size-4" />}
                  selected={tab === 'chats'}
                  onClick={() => setTab('chats')}
                />
                <TabButton
                  label="Contacts"
                  icon={<Users className="size-4" />}
                  selected={tab === 'contacts'}
                  onClick={() => setTab('contacts')}
                />
              </nav>
            </>
          )}
        </section>
      )}

      <TeamChatCreateChannel
        open={channelDialogOpen}
        onOpenChange={setChannelDialogOpen}
        members={chat.members}
        onCreate={chat.createChannel}
      />
    </>
  );
}

function TabButton({
  label,
  icon,
  selected,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? 'page' : undefined}
      className={cn(
        'flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors',
        selected
          ? 'text-primary'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <span className="bg-muted flex size-16 items-center justify-center rounded-full">
        <MessageSquare className="text-muted-foreground size-7" />
      </span>
      <p className="text-muted-foreground text-sm leading-relaxed text-pretty">
        The conversations you have with people and teams will appear here. Open{' '}
        <em>Contacts</em> to message a teammate.
      </p>
    </div>
  );
}
