'use client';

// ============================================================
// PhonePreview — realistic device-framed live preview.
//
// Renders the in-progress template exactly as recipients see it:
// WhatsApp chat bubble (header/body/footer/buttons) or native SMS
// thread, inside an iPhone or Android frame. Pure presentation —
// all state lives in the studio.
// ============================================================

import { ExternalLink, Phone, Reply } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  withSampleValues,
  type CustomTemplateVariable,
  type SmsDraft,
  type TemplateChannel,
  type WhatsAppDraft,
} from '@/features/templates/lib/studio-types';

export type DeviceKind = 'iphone' | 'android';

interface PhonePreviewProps {
  device: DeviceKind;
  channel: TemplateChannel;
  whatsapp: WhatsAppDraft;
  sms: SmsDraft;
  /**
   * Account-defined variables so the preview can substitute custom
   * {{tokens}} with their sample values, same as the built-ins.
   */
  customVariables?: CustomTemplateVariable[];
}

function BubbleButtons({ draft }: { draft: WhatsAppDraft }) {
  if (draft.buttons.length === 0) return null;
  return (
    <div className="mt-px flex flex-col gap-px overflow-hidden rounded-b-lg">
      {draft.buttons.map((btn) => (
        <div
          key={btn.id}
          className="flex items-center justify-center gap-1.5 bg-[#1c2b33] py-2.5 text-[13px] font-medium text-[#53bdeb] dark:bg-[#1c2b33]"
        >
          {btn.kind === 'url' && (
            <ExternalLink className="size-3.5" aria-hidden="true" />
          )}
          {btn.kind === 'call' && (
            <Phone className="size-3.5" aria-hidden="true" />
          )}
          {btn.kind === 'quick_reply' && (
            <Reply className="size-3.5" aria-hidden="true" />
          )}
          {btn.label || 'Button'}
        </div>
      ))}
    </div>
  );
}

function WhatsAppThread({
  draft,
  customVariables,
}: {
  draft: WhatsAppDraft;
  customVariables?: CustomTemplateVariable[];
}) {
  const body = withSampleValues(draft.body, customVariables);
  const header = withSampleValues(draft.headerText, customVariables);
  return (
    <div
      className="flex h-full flex-col bg-[#0b141a]"
      style={{
        backgroundImage:
          'radial-gradient(circle at 20% 30%, rgba(255,255,255,0.02) 1px, transparent 1px), radial-gradient(circle at 80% 70%, rgba(255,255,255,0.02) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }}
    >
      {/* Chat header */}
      <div className="flex items-center gap-2.5 bg-[#202c33] px-3 py-2">
        <div className="flex size-8 items-center justify-center rounded-full bg-[#6a7175] text-[11px] font-semibold text-white">
          A
        </div>
        <div className="leading-tight">
          <p className="text-[13px] font-semibold text-[#e9edef]">Axon</p>
          <p className="text-[10px] text-[#8696a0]">Business account</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <div className="mx-auto mb-3 w-fit rounded-md bg-[#182229] px-2 py-1 text-[10px] text-[#8696a0]">
          Today
        </div>
        <div className="max-w-[85%]">
          <div className="overflow-hidden rounded-lg rounded-tl-none bg-[#202c33] shadow-sm">
            {draft.headerKind === 'image' && (
              <div className="flex aspect-[2/1] items-center justify-center bg-[#2a3942] text-[11px] text-[#8696a0]">
                Header image
              </div>
            )}
            <div className="px-2.5 pt-2 pb-1.5">
              {draft.headerKind === 'text' && header && (
                <p className="mb-1 text-[13.5px] leading-snug font-bold text-[#e9edef]">
                  {header}
                </p>
              )}
              <p className="text-[13.5px] leading-snug whitespace-pre-wrap text-[#e9edef]">
                {body || 'Start typing to see your message here…'}
              </p>
              {draft.footer && (
                <p className="mt-1 text-[11px] leading-snug text-[#8696a0]">
                  {draft.footer}
                </p>
              )}
              <p className="mt-0.5 text-right text-[10px] text-[#8696a0]">
                10:42 AM
              </p>
            </div>
          </div>
          <BubbleButtons draft={draft} />
        </div>
      </div>
    </div>
  );
}

function SmsThread({
  draft,
  device,
  customVariables,
}: {
  draft: SmsDraft;
  device: DeviceKind;
  customVariables?: CustomTemplateVariable[];
}) {
  const body = withSampleValues(draft.body, customVariables);
  const isIphone = device === 'iphone';
  return (
    <div
      className={cn(
        'flex h-full flex-col',
        isIphone ? 'bg-black' : 'bg-[#121212]'
      )}
    >
      {/* Thread header */}
      <div
        className={cn(
          'flex flex-col items-center gap-1 px-3 pt-1.5 pb-2',
          isIphone ? 'bg-[#1c1c1e]' : 'bg-[#1e1e1e]'
        )}
      >
        <div
          className={cn(
            'flex items-center justify-center rounded-full font-semibold text-white',
            isIphone
              ? 'size-9 bg-[#8e8e93] text-[13px]'
              : 'size-8 bg-[#7c4dff] text-[12px]'
          )}
        >
          A
        </div>
        <p className="text-[11px] font-medium text-white">Axon</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <p className="mb-3 text-center text-[10px] text-[#8e8e93]">
          {isIphone ? 'Text Message · Today 10:42 AM' : 'Today · 10:42 AM'}
        </p>
        <div className="max-w-[85%]">
          <div
            className={cn(
              'w-fit px-3 py-2 text-[13.5px] leading-snug whitespace-pre-wrap text-white',
              isIphone
                ? 'rounded-2xl rounded-bl-md bg-[#3a3a3c]'
                : 'rounded-2xl rounded-bl-sm bg-[#2d2d2d]'
            )}
          >
            {body || 'Start typing to see your message here…'}
          </div>
        </div>
      </div>
    </div>
  );
}

export function PhonePreview({
  device,
  channel,
  whatsapp,
  sms,
  customVariables,
}: PhonePreviewProps) {
  const isIphone = device === 'iphone';
  return (
    <div
      aria-label={`${isIphone ? 'iPhone' : 'Android'} preview of the ${channel === 'whatsapp' ? 'WhatsApp' : 'SMS'} template`}
      className={cn(
        'relative mx-auto h-[560px] w-[272px] overflow-hidden border-[6px] shadow-2xl transition-all duration-300',
        isIphone
          ? 'rounded-[44px] border-[#3a3a3c] bg-black'
          : 'rounded-[28px] border-[#2c2c2e] bg-[#121212]'
      )}
    >
      {/* Hardware cues */}
      {isIphone ? (
        <div className="absolute top-2 left-1/2 z-10 h-[22px] w-[86px] -translate-x-1/2 rounded-full bg-black" />
      ) : (
        <div className="absolute top-2 left-1/2 z-10 size-2.5 -translate-x-1/2 rounded-full bg-[#2c2c2e]" />
      )}

      {/* Status bar spacer */}
      <div className={cn('w-full', isIphone ? 'h-9 bg-transparent' : 'h-7')} />

      <div className="h-[calc(100%-2.25rem)] overflow-hidden">
        {channel === 'whatsapp' ? (
          <WhatsAppThread draft={whatsapp} customVariables={customVariables} />
        ) : (
          <SmsThread
            draft={sms}
            device={device}
            customVariables={customVariables}
          />
        )}
      </div>

      {/* Home indicator */}
      {isIphone && (
        <div className="absolute bottom-1.5 left-1/2 z-10 h-1 w-[100px] -translate-x-1/2 rounded-full bg-white/40" />
      )}
    </div>
  );
}
