'use client';

// TEMPORARY probe page used to measure the import dialog's flex/scroll
// box model without needing an authenticated session. Delete after use.

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';

export default function LayoutProbePage() {
  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent className="flex max-h-[92dvh] w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader
          data-probe="header"
          className="shrink-0 border-b px-4 py-4 sm:px-6 sm:py-5"
        >
          <DialogTitle>Import contacts from CSV</DialogTitle>
          <DialogDescription>
            Map any spreadsheet columns to core and custom contact fields.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea data-probe="scroll" className="min-h-0 flex-1">
          <div className="p-4 sm:p-6">
            <div className="flex flex-col gap-5">
              {Array.from({ length: 30 }).map((_, index) => (
                <div key={index} className="bg-muted/20 rounded-lg border p-4">
                  Filler row {index + 1}
                </div>
              ))}
            </div>
          </div>
        </ScrollArea>
        <DialogFooter
          data-probe="footer"
          className="bg-muted/50 m-0 shrink-0 border-t px-4 py-3 sm:px-6 sm:py-4"
        >
          <Button variant="outline">Back</Button>
          <Button>Review data</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
