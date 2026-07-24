import type { Metadata } from 'next';

import { PageContainer } from '@/components/layout/page-container';
import { TemplateStudio } from '@/features/templates/components/template-studio';

export const metadata: Metadata = {
  title: 'Template Studio',
  description:
    'Design WhatsApp and SMS message templates with a live device preview before sending broadcasts.',
};

export default function TemplatesPage() {
  return (
    <PageContainer width="full">
      <header>
        <h1 className="text-foreground text-xl font-semibold">
          Template Studio
        </h1>
        <p className="text-muted-foreground mt-1 text-sm text-pretty">
          Design reusable WhatsApp and SMS templates for broadcasts and
          automations, and preview exactly how they land on a recipient&apos;s
          phone.
        </p>
      </header>
      <TemplateStudio />
    </PageContainer>
  );
}
