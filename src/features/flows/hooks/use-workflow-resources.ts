'use client';

/**
 * Shared, cached resource lookups for the Workflows builder.
 *
 * Every action-node form (send_template, assign_conversation,
 * create_deal, update_contact_field, set_tag…) needs some slice of
 * the same account data: approved templates, team members, pipelines
 * with stages, tags, custom fields.
 *
 * One SWR key per resource means:
 *  - opening five node forms fetches each dataset at most once
 *  - the cache is shared with any other component using these hooks
 *  - revalidation is centralized (focus revalidation off — this data
 *    changes rarely and refetch-on-focus would jitter open forms)
 *
 * All Supabase reads are RLS-scoped to the caller's account. Members
 * go through /api/account/members so its email-visibility rules are
 * inherited.
 */

import useSWR from 'swr';
import { createClient } from '@/lib/supabase/client';

const SWR_OPTS = {
  revalidateOnFocus: false,
  dedupingInterval: 60_000,
} as const;

export interface TemplateOption {
  id: string;
  name: string;
  language: string;
}

export interface MemberOption {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: string;
}

export interface PipelineOption {
  id: string;
  name: string;
}

export interface StageOption {
  id: string;
  name: string;
  pipeline_id: string;
  position: number;
}

export interface CustomFieldOption {
  id: string;
  field_name: string;
}

/** APPROVED templates only — anything else 400s at send time. */
export function useApprovedTemplates() {
  const { data } = useSWR<TemplateOption[]>(
    'workflow-resources:templates',
    async () => {
      const { data: rows } = await createClient()
        .from('message_templates')
        .select('id, name, language')
        .eq('status', 'APPROVED')
        .order('name');
      return (rows as TemplateOption[] | null) ?? [];
    },
    SWR_OPTS
  );
  return data ?? [];
}

export function useAccountMembers() {
  const { data } = useSWR<MemberOption[]>(
    'workflow-resources:members',
    async () => {
      const res = await fetch('/api/account/members', {
        cache: 'no-store',
      }).catch(() => null);
      if (!res || !res.ok) return [];
      const json = (await res.json()) as { members?: MemberOption[] };
      return json.members ?? [];
    },
    SWR_OPTS
  );
  return data ?? [];
}

export function usePipelinesWithStages() {
  const { data } = useSWR<{ pipelines: PipelineOption[]; stages: StageOption[] }>(
    'workflow-resources:pipelines',
    async () => {
      const db = createClient();
      const [p, s] = await Promise.all([
        db.from('pipelines').select('id, name').order('name'),
        db
          .from('pipeline_stages')
          .select('id, name, pipeline_id, position')
          .order('position'),
      ]);
      return {
        pipelines: (p.data as PipelineOption[] | null) ?? [],
        stages: (s.data as StageOption[] | null) ?? [],
      };
    },
    SWR_OPTS
  );
  return data ?? { pipelines: [], stages: [] };
}

export function useCustomFields() {
  const { data } = useSWR<CustomFieldOption[]>(
    'workflow-resources:custom-fields',
    async () => {
      const { data: rows } = await createClient()
        .from('custom_fields')
        .select('id, field_name')
        .order('field_name');
      return (rows as CustomFieldOption[] | null) ?? [];
    },
    SWR_OPTS
  );
  return data ?? [];
}
