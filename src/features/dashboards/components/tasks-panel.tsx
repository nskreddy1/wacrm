'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';

import type { OpenTask } from '@/lib/data/dashboard/types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { ChartCard } from './chart-card';

const dueFormatter = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
});

const PRIORITY_BADGE: Record<OpenTask['priority'], string> = {
  high: 'bg-destructive/10 text-destructive',
  medium: 'bg-primary/10 text-primary',
  low: 'bg-muted text-muted-foreground',
};

/** Open follow-ups with inline quick-add and one-click complete. */
export function TasksPanel({
  tasks,
  onChanged,
}: {
  tasks: OpenTask[];
  onChanged: () => void;
}) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [completing, setCompleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function createTask() {
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/workspace/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!res.ok) throw new Error('Could not add the task');
      setTitle('');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the task');
    } finally {
      setBusy(false);
    }
  }

  async function completeTask(id: string) {
    if (completing) return;
    setCompleting(id);
    setError(null);
    try {
      const res = await fetch('/api/v1/workspace/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: 'done' }),
      });
      if (!res.ok) throw new Error('Could not complete the task');
      onChanged();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not complete the task'
      );
    } finally {
      setCompleting(null);
    }
  }

  return (
    <ChartCard
      title="Tasks"
      caption="Open follow-ups, most urgent first"
      contentClassName="flex flex-col gap-1 p-0"
    >
      <form
        className="border-border flex items-center gap-2 border-b px-4 py-2.5"
        onSubmit={(event) => {
          event.preventDefault();
          createTask();
        }}
      >
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Add a follow-up…"
          maxLength={200}
          aria-label="New task title"
          className="h-8 border-0 bg-transparent px-1 text-[13px] shadow-none focus-visible:ring-0"
        />
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          disabled={!title.trim() || busy}
          className="text-primary hover:text-primary h-7 gap-1 px-2 text-xs font-medium"
        >
          <Plus className="size-3.5" aria-hidden="true" /> Add
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-destructive px-4 py-1 text-xs">
          {error}
        </p>
      )}
      {tasks.length === 0 ? (
        <p className="text-muted-foreground px-4 py-5 text-center text-xs">
          No open tasks. Nice work.
        </p>
      ) : (
        <ul className="divide-border divide-y">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-center gap-3 px-4 py-2">
              <Checkbox
                aria-label={`Mark "${task.title}" as done`}
                checked={completing === task.id}
                disabled={completing !== null}
                onCheckedChange={() => completeTask(task.id)}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">
                  {task.title}
                </span>
                <span className="text-muted-foreground mt-0.5 flex items-center gap-2 text-[11px]">
                  {task.contact && (
                    <span className="truncate">{task.contact}</span>
                  )}
                  {task.dueAt && (
                    <span
                      className={cn(
                        'shrink-0 tabular-nums',
                        task.overdue && 'text-destructive font-semibold'
                      )}
                    >
                      {task.overdue ? 'Overdue · ' : 'Due '}
                      {dueFormatter.format(new Date(task.dueAt))}
                    </span>
                  )}
                </span>
              </span>
              <span
                className={cn(
                  'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize',
                  PRIORITY_BADGE[task.priority]
                )}
              >
                {task.priority}
              </span>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}
