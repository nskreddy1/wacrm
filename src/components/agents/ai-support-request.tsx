'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { LifeBuoy, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const TOPICS = [
  { value: 'setup_help', label: 'Getting set up' },
  { value: 'api_key', label: 'API key / provider issues' },
  { value: 'prompt_tuning', label: 'Prompt tuning' },
  { value: 'handoff', label: 'Handoff / escalation' },
  { value: 'other', label: 'Something else' },
] as const;

const STATUS_BADGE: Record<string, { label: string; variant: 'outline' | 'secondary' | 'default' }> = {
  pending: { label: 'Pending', variant: 'outline' },
  in_progress: { label: 'In progress', variant: 'secondary' },
  resolved: { label: 'Resolved', variant: 'default' },
};

interface SupportRequest {
  id: string;
  topic: string;
  message: string;
  contact_info: string | null;
  status: 'pending' | 'in_progress' | 'resolved';
  created_at: string;
}

export function AiSupportRequestCard() {
  const [requests, setRequests] = useState<SupportRequest[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [topic, setTopic] = useState<string>('setup_help');
  const [message, setMessage] = useState('');
  const [contactInfo, setContactInfo] = useState('');
  const [sending, setSending] = useState(false);

  const fetchRequests = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/support-requests');
      const data = await res.json().catch(() => ({}));
      if (res.ok) setRequests(data.requests ?? []);
    } catch {
      // Best-effort — the card still lets you submit a new request.
    }
  }, []);

  useEffect(() => {
    void fetchRequests();
  }, [fetchRequests]);

  const submit = async () => {
    if (!message.trim()) {
      toast.error('Tell us what you need help with.');
      return;
    }
    setSending(true);
    try {
      const res = await fetch('/api/ai/support-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          message: message.trim(),
          contact_info: contactInfo.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to send request');
        return;
      }
      toast.success('Request sent — our team will get back to you.');
      setDialogOpen(false);
      setMessage('');
      setContactInfo('');
      await fetchRequests();
    } catch {
      toast.error('Failed to send request');
    } finally {
      setSending(false);
    }
  };

  const topicLabel = (value: string) =>
    TOPICS.find((t) => t.value === value)?.label ?? value;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <LifeBuoy className="h-5 w-5 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">
                Need help configuring AI?
              </p>
              <p className="text-xs text-muted-foreground">
                Our team can help with setup, API keys and prompt tuning.
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
            Request help
          </Button>
        </div>

        {requests.length > 0 && (
          <ul className="flex flex-col gap-1.5 border-t border-border pt-3">
            {requests.slice(0, 3).map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 text-xs"
              >
                <span className="min-w-0 truncate text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {topicLabel(r.topic)}
                  </span>
                  {' — '}
                  {r.message}
                </span>
                <Badge
                  variant={STATUS_BADGE[r.status]?.variant ?? 'outline'}
                  className="shrink-0 text-[10px]"
                >
                  {STATUS_BADGE[r.status]?.label ?? r.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request AI configuration help</DialogTitle>
            <DialogDescription>
              Describe what you need — the platform team sees these requests
              and will follow up.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="space-y-2">
              <Label>Topic</Label>
              <Select
                value={topic}
                onValueChange={(v) => setTopic(v ?? TOPICS[0].value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TOPICS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="support-message">Message</Label>
              <Textarea
                id="support-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="What are you trying to do, and where are you stuck?"
                rows={4}
                maxLength={4000}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="support-contact">
                Contact info{' '}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="support-contact"
                value={contactInfo}
                onChange={(e) => setContactInfo(e.target.value)}
                placeholder="Email or phone if different from your account"
                maxLength={200}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={sending || !message.trim()}>
              {sending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
