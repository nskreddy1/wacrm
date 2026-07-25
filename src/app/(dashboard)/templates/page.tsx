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
      {/* No visible hero header — the studio's channel rail and badge
          already announce where you are (Zoho/Linear pattern: nav owns
          the page name, content owns the workspace). The h1 stays for
          screen readers and SEO. */}
      <h1 className="sr-only">Template Studio</h1>
      <TemplateStudio />
    </PageContainer>
  );
}
