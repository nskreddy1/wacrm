import type { Metadata } from 'next';

import { TemplateStudio } from '@/features/templates/components/template-studio';

export const metadata: Metadata = {
  title: 'Template Studio',
  description:
    'Design WhatsApp, SMS, and email message templates with a live preview before sending broadcasts.',
};

export default function TemplatesPage() {
  return (
    // Full-bleed workspace (like Inbox/Pipelines) so the channel
    // strip docks flush against the app sidebar with no gutter.
    // Nav owns the page name — the h1 stays for screen readers.
    <div className="flex h-0 min-h-0 w-full flex-1">
      <h1 className="sr-only">Template Studio</h1>
      <TemplateStudio />
    </div>
  );
}
