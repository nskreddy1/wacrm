'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Bot,
  Copy,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Power,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { BotTemplate } from '@/lib/ai/bot-templates';
import { BotEditor } from './bot-editor';
import { BotTemplateGallery } from './bot-template-gallery';
import { TONE_LABEL, type BotRow } from './bot-types';

/** Confirmation state for destructive/switching actions. */
type Confirm =
  | { kind: 'activate'; bot: BotRow; activeName: string | null }
  | { kind: 'delete'; bot: BotRow }
  | null;

export function BotsList() {
  const { accountId, accountRole } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;

  const [bots, setBots] = useState<BotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);

  // Editor / gallery wiring
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<BotRow | null>(null);
  const [prefill, setPrefill] = useState<Partial<BotRow> | undefined>(undefined);
  const [galleryOpen, setGalleryOpen] = useState(false);

  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchBots = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/bots');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to load bots');
        return;
      }
      setBots(data.bots ?? []);
    } catch {
      toast.error('Failed to load bots');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    setLoading(true);
    void fetchBots();
  }, [accountId, fetchBots]);

  const activeBot = bots.find((b) => b.is_active) ?? null;

  const openCreate = () => {
    setEditing(null);
    setPrefill(undefined);
    setEditorOpen(true);
  };

  const openEdit = (bot: BotRow) => {
    setEditing(bot);
    setPrefill(undefined);
    setEditorOpen(true);
  };

  const openDuplicate = (bot: BotRow) => {
    setEditing(null);
    setPrefill({ ...bot, name: `${bot.name} (copy)` });
    setEditorOpen(true);
  };

  const useTemplate = (t: BotTemplate) => {
    setGalleryOpen(false);
    setEditing(null);
    setPrefill({
      name: t.name,
      emoji: t.emoji,
      description: t.description,
      system_prompt: t.systemPrompt,
      tone: t.tone,
      greeting_message: t.greetingMessage,
      template_key: t.key,
    } as Partial<BotRow>);
    setEditorOpen(true);
  };

  const activate = async (bot: BotRow) => {
    setBusyId(bot.id);
    try {
      const res = await fetch(`/api/ai/bots/${bot.id}/activate`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to activate bot');
        return;
      }
      toast.success(`${bot.name} is now live on WhatsApp`);
      await fetchBots();
    } catch {
      toast.error('Failed to activate bot');
    } finally {
      setBusyId(null);
      setConfirm(null);
    }
  };

  const remove = async (bot: BotRow) => {
    setBusyId(bot.id);
    try {
      const res = await fetch(`/api/ai/bots/${bot.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? 'Failed to delete bot');
        return;
      }
      toast.success('Bot deleted');
      await fetchBots();
    } catch {
      toast.error('Failed to delete bot');
    } finally {
      setBusyId(null);
      setConfirm(null);
    }
  };

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-40 rounded-xl" />
        ))}
        <span className="sr-only">Loading bots</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {activeBot ? (
            <>
              <span className="font-medium text-foreground">{activeBot.name}</span>{' '}
              answers customers on WhatsApp. Only one bot is live at a time.
            </>
          ) : (
            'No bot is live — activate one to answer customers on WhatsApp.'
          )}
        </p>
        {canEdit && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setGalleryOpen(true)}>
              <Sparkles className="mr-1.5 h-4 w-4" /> Browse templates
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="mr-1.5 h-4 w-4" /> New bot
            </Button>
          </div>
        )}
      </div>

      {/* Empty state */}
      {bots.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Bot className="h-10 w-10 text-muted-foreground/60" />
            <div>
              <p className="font-medium text-foreground">No bots yet</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Create a bot persona from scratch or start with a proven
                template — support, sales, bookings and more.
              </p>
            </div>
            {canEdit && (
              <div className="mt-2 flex gap-2">
                <Button variant="outline" onClick={() => setGalleryOpen(true)}>
                  <Sparkles className="mr-1.5 h-4 w-4" /> Browse templates
                </Button>
                <Button onClick={openCreate}>
                  <Plus className="mr-1.5 h-4 w-4" /> New bot
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {bots.map((bot) => (
            <Card
              key={bot.id}
              className={
                bot.is_active ? 'border-primary/50 ring-1 ring-primary/30' : undefined
              }
            >
              <CardContent className="flex h-full flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-lg"
                      aria-hidden="true"
                    >
                      {bot.emoji || '🤖'}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {bot.name}
                      </p>
                      <Badge variant="outline" className="mt-0.5 text-[10px]">
                        {TONE_LABEL[bot.tone]}
                      </Badge>
                    </div>
                  </div>
                  {canEdit && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          aria-label={`Actions for ${bot.name}`}
                          disabled={busyId === bot.id}
                        >
                          {busyId === bot.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <MoreHorizontal className="h-4 w-4" />
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(bot)}>
                          <Pencil className="mr-2 h-4 w-4" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openDuplicate(bot)}>
                          <Copy className="mr-2 h-4 w-4" /> Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setConfirm({ kind: 'delete', bot })}
                        >
                          <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>

                {bot.description && (
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {bot.description}
                  </p>
                )}

                <div className="mt-auto flex items-center justify-between pt-1">
                  {bot.is_active ? (
                    <Badge className="bg-primary/15 text-primary hover:bg-primary/15">
                      Active on WhatsApp
                    </Badge>
                  ) : canEdit ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setConfirm({
                          kind: 'activate',
                          bot,
                          activeName: activeBot?.name ?? null,
                        })
                      }
                      disabled={busyId !== null}
                    >
                      <Power className="mr-1.5 h-3.5 w-3.5" /> Activate
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">Inactive</span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Confirm dialogs */}
      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          {confirm?.kind === 'activate' && (
            <>
              <DialogHeader>
                <DialogTitle>Activate {confirm.bot.name}?</DialogTitle>
                <DialogDescription>
                  {confirm.activeName
                    ? `${confirm.activeName} will stop answering customers and ${confirm.bot.name} will take over immediately.`
                    : `${confirm.bot.name} will start answering customers on WhatsApp (when auto-reply is enabled in Connection).`}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirm(null)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => activate(confirm.bot)}
                  disabled={busyId !== null}
                >
                  {busyId && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                  Activate
                </Button>
              </DialogFooter>
            </>
          )}
          {confirm?.kind === 'delete' && (
            <>
              <DialogHeader>
                <DialogTitle>Delete {confirm.bot.name}?</DialogTitle>
                <DialogDescription>
                  {confirm.bot.is_active
                    ? 'This bot is live — deleting it stops its persona immediately. Auto-reply falls back to the base assistant behavior.'
                    : 'This cannot be undone.'}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setConfirm(null)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => remove(confirm.bot)}
                  disabled={busyId !== null}
                >
                  {busyId && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                  Delete
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <BotEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        bot={editing}
        prefill={prefill}
        onSaved={fetchBots}
        onBrowseTemplates={() => setGalleryOpen(true)}
      />

      <BotTemplateGallery
        open={galleryOpen}
        onOpenChange={setGalleryOpen}
        onUseTemplate={useTemplate}
      />
    </div>
  );
}
