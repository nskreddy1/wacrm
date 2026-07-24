"use client";

// ============================================================
// WorkspaceNameCard — Settings → Team members (top card)
//
// Lets admin+ rename the workspace. The name seeds as the email at
// signup (handle_new_user falls back to NEW.email), which is why the
// sidebar used to show the same address twice. RLS `accounts_update`
// already restricts writes to admin+ (is_account_member(id,'admin')),
// so a direct client-side update is safe; non-admins see read-only.
// ============================================================

import { useState } from "react";
import { toast } from "sonner";
import { Building2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/features/auth/hooks/use-auth";
import { looksLikeEmail, workspaceDisplayName } from "@/lib/display-name";
import { createClient } from "@/lib/supabase/client";

export function WorkspaceNameCard() {
  const { account, canEditSettings, refreshProfile } = useAuth();
  // null = untouched: derive from the loaded account (friendly derivation,
  // not the raw email) so saving as-is immediately fixes the sidebar label.
  // No sync effect needed — the input renders the derived value directly.
  const [draftName, setDraftName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const name = draftName ?? (account ? workspaceDisplayName(account.name) : "");
  const setName = setDraftName;

  if (!account) return null;

  const stillDefault = looksLikeEmail(account.name);
  const dirty = name.trim() !== account.name && name.trim().length > 0;

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
      setDraftName(null); // back to deriving from the refreshed account
      toast.success("Workspace renamed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rename workspace.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Building2 className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Workspace name</p>
            <p className="truncate text-xs text-muted-foreground">
              {canEditSettings
                ? "Shown to every member in the sidebar and dashboard."
                : "Only owners and admins can rename the workspace."}
            </p>
          </div>
        </div>

        {canEditSettings ? (
          <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="workspace-name">Name</Label>
              <Input
                id="workspace-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                disabled={saving}
                placeholder="Acme Inc"
                required
              />
              {stillDefault && (
                <p className="text-xs text-muted-foreground">
                  Your workspace is still using its signup default. Give it a proper name.
                </p>
              )}
            </div>
            <Button type="submit" disabled={saving || !dirty}>
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Saving
                </>
              ) : (
                "Save"
              )}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-foreground">{workspaceDisplayName(account.name)}</p>
        )}
      </CardContent>
    </Card>
  );
}
