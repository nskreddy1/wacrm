import { SheetTableSkeleton } from '@/components/ui/loading-skeletons';

/**
 * Route-level loader for /contacts. Renders the EXACT same sheet
 * skeleton (same column/row counts) as ContactWorkspace's own
 * data-loading state, so the route transition and the SWR cold load
 * read as one continuous loading phase instead of two different
 * screens flashing in sequence.
 */
export default function ContactsLoading() {
  return <SheetTableSkeleton columns={6} rows={14} />;
}
