"use client";

// ============================================================
// WorkspaceRenameDialog — rename the workspace from anywhere
// (sidebar account menu). Mirrors the Settings → Team members
// card: RLS `accounts_update` restricts writes to admin+, so a
// direct client-side update is safe. On success the auth context
// refreshes so the sidebar brand line updates instantly.
// ============================================================

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { looksLikeEmail, workspaceDisplayName } from "@/lib/display-name";
import { createClient } from "@/lib/supabase/client";

export function WorkspaceRenameDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { account, refreshProfile } = useAuth();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  // Re-seed the field each time the dialog opens so a cancelled edit
  // never leaks stale text into the next session.
  useEffect(() => {
    if (open && account) setName(workspaceDisplayName(account.name));
  }, [open, account]);

  if (!account) return null;

  const stillDefault = looksLikeEmail(account.name);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 80) {
      toast.error("Workspace name must be 1–80 characters.");
      return;
    }
    setSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("accounts")
        .update({ name: trimmed })
        .eq("id", account.id);
      if (error) throw new Error(error.message);
      await refreshProfile();
      toast.success("Workspace renamed.");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rename workspace.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename workspace</DialogTitle>
          <DialogDescription>
            This name is shown to every member in the sidebar and dashboard.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor="sidebar-workspace-name">Workspace name</Label>
            <Input
              id="sidebar-workspace-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              disabled={saving}
              placeholder="Acme Inc"
              autoFocus
              required
            />
            {stillDefault && (
              <p className="text-xs text-muted-foreground">
                Your workspace is still using its signup default. Give it a proper name.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Saving
                </>
              ) : (
                "Save"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
