import {
  ConversationListSkeleton,
  MessageThreadSkeleton,
} from '@/components/ui/loading-skeletons';

/**
 * Route-level loader for /inbox. Mirrors the two-pane inbox layout
 * (conversation rail + thread) with the same skeletons the panes use
 * for their own data loading, so navigation and data fetch appear as
 * a single continuous loading state.
 */
export default function InboxLoading() {
  return (
    <div className="flex min-h-0 flex-1">
      <div className="hidden w-80 shrink-0 border-r md:block">
        <ConversationListSkeleton count={9} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <MessageThreadSkeleton />
      </div>
    </div>
  );
}
