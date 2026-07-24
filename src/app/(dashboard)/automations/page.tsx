import { redirect } from 'next/navigation';

/**
 * Workflows unification: the classic automations module was absorbed
 * into the flow builder. Old bookmarks and deep links land here and
 * are sent to the unified Workflows surface.
 */
export default function AutomationsRedirect() {
  redirect('/flows');
}
