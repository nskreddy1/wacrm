import Image from "next/image";
import { MessageCircleMore, ShieldCheck } from "lucide-react";

export function SignupPromoPanel() {
  return (
    <aside className="relative hidden min-h-[calc(100vh-3rem)] overflow-hidden rounded-3xl lg:block">
      <Image
        src="/wacrm-signup-workspace.png"
        alt="A laptop and phone displaying a modern customer relationship workspace"
        fill
        priority
        sizes="(min-width: 1024px) 50vw, 0px"
        className="object-cover"
      />
      <div className="absolute inset-0 bg-foreground/30" aria-hidden="true" />
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-5 bg-foreground p-10 text-center text-background xl:p-14">
        <div className="flex max-w-xl flex-col items-center gap-3">
          <p className="text-pretty text-3xl font-semibold leading-tight text-background xl:text-4xl">
            Turn every WhatsApp chat into a lasting customer relationship
          </p>
          <p className="max-w-lg text-pretty text-sm leading-relaxed text-background xl:text-base">
            Keep conversations, contacts, deals, and follow-ups together in one
            calm workspace built for growing teams.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3 text-background">
          <div className="flex items-center gap-2 rounded-full border border-background px-4 py-2 text-sm">
            <ShieldCheck aria-hidden="true" />
            Secure customer data
          </div>
          <div className="flex items-center gap-2 rounded-full border border-background px-4 py-2 text-sm">
            <MessageCircleMore aria-hidden="true" />
            Shared team inbox
          </div>
        </div>
      </div>
    </aside>
  );
}
