import Image from "next/image";
import { MessageCircleMore, ShieldCheck } from "lucide-react";

type SignupPromoPanelProps = {
  title?: string;
  description?: string;
};

export function SignupPromoPanel({
  title = "Turn every WhatsApp chat into a lasting customer relationship",
  description = "Keep conversations, contacts, deals, and follow-ups together in one calm workspace built for growing teams.",
}: SignupPromoPanelProps) {
  return (
    <aside className="relative hidden min-h-[calc(100vh-3rem)] overflow-hidden rounded-[2.75rem] lg:block">
      <Image
        src="/wacrm-signup-workspace.png"
        alt="A customer success professional working with WACRM conversations"
        fill
        priority
        sizes="(min-width: 1024px) 50vw, 0px"
        className="object-cover"
      />
      <div className="absolute inset-0 bg-foreground/25" aria-hidden="true" />
      <div className="absolute -left-10 top-0 size-24 rounded-full bg-background" aria-hidden="true" />
      <div className="absolute -bottom-10 -right-10 size-24 rounded-full bg-background" aria-hidden="true" />
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-5 px-8 pb-10 text-center text-background xl:px-12 xl:pb-12">
        <div className="flex max-w-xl flex-col items-center gap-3">
          <p className="text-balance text-3xl font-semibold leading-tight text-background xl:text-4xl">
            {title}
          </p>
          <p className="max-w-lg text-pretty text-sm leading-relaxed text-background xl:text-base">
            {description}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3 text-background">
          <div className="flex items-center gap-2 rounded-full border border-background px-4 py-2 text-sm backdrop-blur-sm">
            <ShieldCheck aria-hidden="true" />
            Secure customer data
          </div>
          <div className="flex items-center gap-2 rounded-full border border-background px-4 py-2 text-sm backdrop-blur-sm">
            <MessageCircleMore aria-hidden="true" />
            Shared team inbox
          </div>
        </div>
      </div>
    </aside>
  );
}
