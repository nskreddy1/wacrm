import type { Metadata } from "next"

import { PageContainer } from "@/components/layout/page-container"
import { TemplateStudio } from "@/components/templates/template-studio"

export const metadata: Metadata = {
  title: "Template Studio",
  description:
    "Design WhatsApp and SMS message templates with a live device preview before sending broadcasts.",
}

export default function TemplatesPage() {
  return (
    <PageContainer width="full">
      <header>
        <h1 className="text-xl font-semibold text-foreground">Template Studio</h1>
        <p className="mt-1 text-sm text-muted-foreground text-pretty">
          Design reusable WhatsApp and SMS templates for broadcasts and automations, and preview
          exactly how they land on a recipient&apos;s phone.
        </p>
      </header>
      <TemplateStudio />
    </PageContainer>
  )
}
