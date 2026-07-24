'use client';

import { useState } from 'react';
import { Hash } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { TeamChatMember } from '@/features/team-chat/hooks/use-team-chat';

import { MemberAvatar } from './member-avatar';

/** "New channel" dialog: name + workspace-member picker. Admin-only per RLS. */
export function TeamChatCreateChannel({
  open,
  onOpenChange,
  members,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: TeamChatMember[];
  onCreate: (
    name: string,
    memberIds: string[]
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function toggle(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function submit() {
    if (!name.trim() || pending) return;
    setPending(true);
    setError(null);
    const result = await onCreate(name.trim(), [...selected]);
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? 'Could not create the channel.');
      return;
    }
    setName('');
    setSelected(new Set());
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create channel</DialogTitle>
          <DialogDescription>
            Channels are shared rooms for your workspace. Pick who&apos;s in it
            — you can add more people later.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="channel-name">Channel name</Label>
            <div className="relative">
              <Hash className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <Input
                id="channel-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. sales-team"
                className="pl-8"
                maxLength={60}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">Members</p>
            <div className="max-h-48 overflow-y-auto rounded-md border">
              {members.length === 0 ? (
                <p className="text-muted-foreground px-3 py-4 text-center text-sm">
                  No other members in this workspace yet.
                </p>
              ) : (
                <ul className="flex flex-col">
                  {members.map((member) => (
                    <li key={member.user_id}>
                      <label className="hover:bg-muted flex cursor-pointer items-center gap-3 px-3 py-2 transition-colors">
                        <Checkbox
                          checked={selected.has(member.user_id)}
                          onCheckedChange={() => toggle(member.user_id)}
                          aria-label={`Add ${member.full_name || member.email}`}
                        />
                        <MemberAvatar
                          name={member.full_name || member.email || '?'}
                          avatarUrl={member.avatar_url}
                          className="size-7"
                        />
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {member.full_name || member.email}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={!name.trim() || pending}
          >
            {pending ? 'Creating…' : 'Create channel'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
