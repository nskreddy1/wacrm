'use client';

import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { Input } from '@/components/ui/input';
import {
  QuickCreateDialog,
  RecordField,
} from '@/components/shared/record-sheet';

/**
 * Bigin-style "Quick Create: Contact" modal. Usable from any editor that
 * needs to add a contact inline (deals, activities, companies…).
 */
export function QuickCreateContact({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (contact: { id: string; name: string }) => void;
}) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const name = [firstName, lastName]
      .map((part) => part.trim())
      .filter(Boolean)
      .join(' ');
    if (!name) {
      setError('Enter at least a first or last name.');
      return;
    }
    if (email && !/^\S+@\S+\.\S+$/.test(email)) {
      setError('Enter a valid email address.');
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/v1/workspace/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          values: {
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            email: email.trim(),
            name,
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error?.message ?? 'Unable to create contact');
      const id = String(payload.data?.id ?? payload.id ?? '');
      toast.success('Contact created');
      setFirstName('');
      setLastName('');
      setEmail('');
      setError('');
      onCreated({ id, name });
      onOpenChange(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to create contact'
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <QuickCreateDialog
      open={open}
      entity="Contact"
      saving={saving}
      onOpenChange={onOpenChange}
      onSubmit={submit}
    >
      <RecordField label="First Name" htmlFor="qc-contact-first-name">
        <Input
          id="qc-contact-first-name"
          autoFocus
          value={firstName}
          onChange={(event) => setFirstName(event.target.value)}
          className="h-11"
        />
      </RecordField>
      <RecordField label="Last Name" htmlFor="qc-contact-last-name">
        <Input
          id="qc-contact-last-name"
          value={lastName}
          onChange={(event) => setLastName(event.target.value)}
          className="h-11"
        />
      </RecordField>
      <RecordField label="Email" htmlFor="qc-contact-email" error={error}>
        <Input
          id="qc-contact-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="h-11"
        />
      </RecordField>
    </QuickCreateDialog>
  );
}
