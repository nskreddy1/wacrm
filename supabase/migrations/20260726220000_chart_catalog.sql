-- ============================================================
-- Generic chart engine — catalog + aggregation RPC.
--
-- Ported from Twenty's chart-data architecture (packages/twenty-server/
-- src/modules/dashboard/chart-data). Twenty resolves charts against its
-- per-workspace *metadata* tables (objectMetadataId / fieldMetadataId),
-- because users define their own objects there. We have a fixed schema,
-- so that metadata layer is replaced by this explicit catalog: it plays
-- exactly the same role — it is the ONLY place an identifier can come
-- from, so no user-supplied string ever reaches SQL as an identifier.
--
-- Security model:
--   * chart_aggregate() is SECURITY INVOKER. Every statement it runs is
--     therefore subject to the caller's RLS policies, exactly as if they
--     had written the SELECT themselves. That is what makes dynamic SQL
--     safe here: the catalog constrains WHICH COLUMNS can be touched and
--     RLS constrains WHICH ROWS come back.
--   * Identifiers are injected with format('%I') only after being read
--     out of the catalog. Timestamp bounds are typed timestamptz values
--     rendered with format('%L'), so they cannot carry SQL either.
--   * search_path is pinned so a hostile session setting cannot shadow
--     the catalog tables or the functions used to build the query.
--   * The catalog tables are readable by authenticated users and have no
--     write policy, so tenants can read the vocabulary but never mutate it.
-- ============================================================

-- ------------------------------------------------------------
-- Catalog: sources (a queryable table)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chart_sources (
  source_key          text PRIMARY KEY,
  table_name          text NOT NULL,
  label               text NOT NULL,
  -- Default timestamp column used for range filtering.
  default_date_column text,
  -- Optional defence-in-depth tenant filter. NULL where the table has no
  -- account_id of its own (e.g. messages, scoped through conversations
  -- by RLS instead).
  account_column      text,
  position            integer NOT NULL DEFAULT 0
);

-- ------------------------------------------------------------
-- Catalog: dimensions (a groupable column)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chart_dimensions (
  source_key      text NOT NULL REFERENCES chart_sources(source_key) ON DELETE CASCADE,
  dimension_key   text NOT NULL,
  column_name     text NOT NULL,
  label           text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('text', 'date', 'bool', 'uuid')),
  -- For kind='uuid': resolve the id to a human label via this table.
  relation_table        text,
  relation_label_column text,
  position        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (source_key, dimension_key),
  CONSTRAINT chart_dimensions_relation_complete CHECK (
    kind <> 'uuid'
    OR (relation_table IS NOT NULL AND relation_label_column IS NOT NULL)
  )
);

-- ------------------------------------------------------------
-- Catalog: measures (an aggregatable column)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chart_measures (
  source_key      text NOT NULL REFERENCES chart_sources(source_key) ON DELETE CASCADE,
  measure_key     text NOT NULL,
  -- NULL means "the rows themselves" -> COUNT(*).
  column_name     text,
  label           text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('number', 'currency')),
  position        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (source_key, measure_key)
);

ALTER TABLE chart_sources    ENABLE ROW LEVEL SECURITY;
ALTER TABLE chart_dimensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chart_measures   ENABLE ROW LEVEL SECURITY;

-- Read-only vocabulary for any signed-in user. No INSERT/UPDATE/DELETE
-- policies exist, so the catalog is immutable outside of migrations.
DROP POLICY IF EXISTS chart_sources_read ON chart_sources;
CREATE POLICY chart_sources_read ON chart_sources
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS chart_dimensions_read ON chart_dimensions;
CREATE POLICY chart_dimensions_read ON chart_dimensions
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS chart_measures_read ON chart_measures;
CREATE POLICY chart_measures_read ON chart_measures
  FOR SELECT TO authenticated USING (true);

-- ============================================================
-- Seed the catalog.
-- ============================================================

INSERT INTO chart_sources
  (source_key, table_name, label, default_date_column, account_column, position)
VALUES
  ('deals',         'deals',         'Deals',         'created_at', 'account_id', 1),
  ('contacts',      'contacts',      'Contacts',      'created_at', 'account_id', 2),
  ('conversations', 'conversations', 'Conversations', 'created_at', 'account_id', 3),
  ('messages',      'messages',      'Messages',      'created_at', NULL,         4),
  ('tasks',         'tasks',         'Tasks',         'created_at', 'account_id', 5),
  ('appointments',  'appointments',  'Appointments',  'starts_at',  'account_id', 6),
  ('broadcasts',    'broadcasts',    'Broadcasts',    'created_at', 'account_id', 7)
ON CONFLICT (source_key) DO UPDATE SET
  table_name          = EXCLUDED.table_name,
  label               = EXCLUDED.label,
  default_date_column = EXCLUDED.default_date_column,
  account_column      = EXCLUDED.account_column,
  position            = EXCLUDED.position;

-- Dimensions -------------------------------------------------
INSERT INTO chart_dimensions
  (source_key, dimension_key, column_name, label, kind,
   relation_table, relation_label_column, position)
VALUES
  -- deals
  ('deals', 'stage',       'stage_id',            'Stage',          'uuid', 'pipeline_stages', 'name',      1),
  ('deals', 'status',      'status',              'Status',         'text', NULL, NULL, 2),
  ('deals', 'priority',    'priority',            'Priority',       'text', NULL, NULL, 3),
  ('deals', 'leadSource',  'lead_source',         'Lead source',    'text', NULL, NULL, 4),
  ('deals', 'campaign',    'campaign',            'Campaign',       'text', NULL, NULL, 5),
  ('deals', 'company',     'company',             'Company',        'text', NULL, NULL, 6),
  ('deals', 'owner',       'assigned_to',         'Owner',          'uuid', 'profiles', 'full_name', 7),
  ('deals', 'createdAt',   'created_at',          'Created date',   'date', NULL, NULL, 8),
  ('deals', 'closedAt',    'closed_at',           'Closed date',    'date', NULL, NULL, 9),
  ('deals', 'expectedAt',  'expected_close_date', 'Expected close', 'date', NULL, NULL, 10),

  -- contacts
  ('contacts', 'source',       'source',          'Source',          'text', NULL, NULL, 1),
  ('contacts', 'sourceDetail', 'source_detail',   'Source detail',   'text', NULL, NULL, 2),
  ('contacts', 'campaign',     'campaign',        'Campaign',        'text', NULL, NULL, 3),
  ('contacts', 'company',      'company',         'Company',         'text', NULL, NULL, 4),
  ('contacts', 'smsOptOut',    'sms_opted_out',   'SMS opted out',   'bool', NULL, NULL, 5),
  ('contacts', 'emailOptOut',  'email_opted_out', 'Email opted out', 'bool', NULL, NULL, 6),
  ('contacts', 'createdAt',    'created_at',      'Created date',    'date', NULL, NULL, 7),

  -- conversations
  ('conversations', 'status',      'status',            'Status',         'text', NULL, NULL, 1),
  ('conversations', 'channel',     'channel',           'Channel',        'text', NULL, NULL, 2),
  ('conversations', 'sentiment',   'ai_sentiment',      'AI sentiment',   'text', NULL, NULL, 3),
  ('conversations', 'agent',       'assigned_agent_id', 'Assigned agent', 'uuid', 'profiles', 'full_name', 4),
  ('conversations', 'createdAt',   'created_at',        'Created date',   'date', NULL, NULL, 5),
  ('conversations', 'lastMessage', 'last_message_at',   'Last message',   'date', NULL, NULL, 6),

  -- messages
  ('messages', 'senderType',  'sender_type',  'Sender type',  'text', NULL, NULL, 1),
  ('messages', 'contentType', 'content_type', 'Content type', 'text', NULL, NULL, 2),
  ('messages', 'status',      'status',       'Status',       'text', NULL, NULL, 3),
  ('messages', 'aiGenerated', 'ai_generated', 'AI generated', 'bool', NULL, NULL, 4),
  ('messages', 'createdAt',   'created_at',   'Sent date',    'date', NULL, NULL, 5),

  -- tasks
  ('tasks', 'status',    'status',      'Status',       'text', NULL, NULL, 1),
  ('tasks', 'priority',  'priority',    'Priority',     'text', NULL, NULL, 2),
  ('tasks', 'assignee',  'assigned_to', 'Assignee',     'uuid', 'profiles', 'full_name', 3),
  ('tasks', 'dueAt',     'due_at',      'Due date',     'date', NULL, NULL, 4),
  ('tasks', 'createdAt', 'created_at',  'Created date', 'date', NULL, NULL, 5),

  -- appointments
  ('appointments', 'status',    'status',      'Status',       'text', NULL, NULL, 1),
  ('appointments', 'assignee',  'assigned_to', 'Assignee',     'uuid', 'profiles', 'full_name', 2),
  ('appointments', 'startsAt',  'starts_at',   'Start date',   'date', NULL, NULL, 3),
  ('appointments', 'createdAt', 'created_at',  'Created date', 'date', NULL, NULL, 4),

  -- broadcasts
  ('broadcasts', 'status',    'status',     'Status',       'text', NULL, NULL, 1),
  ('broadcasts', 'channel',   'channel',    'Channel',      'text', NULL, NULL, 2),
  ('broadcasts', 'createdAt', 'created_at', 'Created date', 'date', NULL, NULL, 3)
ON CONFLICT (source_key, dimension_key) DO UPDATE SET
  column_name           = EXCLUDED.column_name,
  label                 = EXCLUDED.label,
  kind                  = EXCLUDED.kind,
  relation_table        = EXCLUDED.relation_table,
  relation_label_column = EXCLUDED.relation_label_column,
  position              = EXCLUDED.position;

-- Measures ---------------------------------------------------
INSERT INTO chart_measures
  (source_key, measure_key, column_name, label, kind, position)
VALUES
  ('deals', 'count',       NULL,          'Number of deals', 'number',   1),
  ('deals', 'value',       'value',       'Deal value',      'currency', 2),
  ('deals', 'probability', 'probability', 'Probability',     'number',   3),

  ('contacts', 'count', NULL, 'Number of contacts', 'number', 1),

  ('conversations', 'count',     NULL,             'Number of conversations', 'number', 1),
  ('conversations', 'unread',    'unread_count',   'Unread messages',         'number', 2),
  ('conversations', 'aiReplies', 'ai_reply_count', 'AI replies',              'number', 3),

  ('messages', 'count', NULL, 'Number of messages', 'number', 1),

  ('tasks', 'count', NULL, 'Number of tasks', 'number', 1),

  ('appointments', 'count', NULL, 'Number of appointments', 'number', 1),

  ('broadcasts', 'count',      NULL,              'Number of broadcasts', 'number', 1),
  ('broadcasts', 'recipients', 'total_recipients', 'Recipients',          'number', 2),
  ('broadcasts', 'sent',       'sent_count',      'Sent',                 'number', 3),
  ('broadcasts', 'delivered',  'delivered_count', 'Delivered',            'number', 4),
  ('broadcasts', 'read',       'read_count',      'Read',                 'number', 5),
  ('broadcasts', 'replied',    'replied_count',   'Replied',              'number', 6),
  ('broadcasts', 'failed',     'failed_count',    'Failed',               'number', 7)
ON CONFLICT (source_key, measure_key) DO UPDATE SET
  column_name = EXCLUDED.column_name,
  label       = EXCLUDED.label,
  kind        = EXCLUDED.kind,
  position    = EXCLUDED.position;

-- ============================================================
-- Helper: render a groupable column as a stable text bucket.
-- Defined before chart_aggregate() so the dependency is explicit.
-- ============================================================
CREATE OR REPLACE FUNCTION chart_dimension_expression(
  p_alias       text,
  p_column      text,
  p_kind        text,
  p_granularity text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trunc text;
BEGIN
  IF p_kind = 'date' THEN
    v_trunc := CASE p_granularity
      WHEN 'day'     THEN 'day'
      WHEN 'week'    THEN 'week'
      WHEN 'month'   THEN 'month'
      WHEN 'quarter' THEN 'quarter'
      WHEN 'year'    THEN 'year'
      ELSE NULL
    END;

    IF v_trunc IS NULL THEN
      RAISE EXCEPTION 'chart_aggregate: unsupported granularity %', p_granularity
        USING ERRCODE = '22023';
    END IF;

    -- to_char keeps buckets sortable as plain text (YYYY-MM-DD).
    RETURN format(
      'to_char(date_trunc(%L, %I.%I), ''YYYY-MM-DD'')',
      v_trunc, p_alias, p_column
    );
  END IF;

  IF p_kind = 'bool' THEN
    RETURN format(
      'CASE WHEN %I.%I THEN ''Yes'' WHEN %I.%I IS NULL THEN NULL ELSE ''No'' END',
      p_alias, p_column, p_alias, p_column
    );
  END IF;

  -- text + uuid (uuid is rewritten by the caller once the label is joined)
  RETURN format('%I.%I::text', p_alias, p_column);
END;
$$;

-- ============================================================
-- chart_aggregate() — the single generic query entry point.
--
-- Returns a jsonb array of buckets:
--   [{ "bucket": text|null, "series": text|null, "value": numeric }, ...]
--
-- p_dimension NULL -> one row, bucket NULL  (an AGGREGATE / KPI chart)
-- p_series    NULL -> one series            (pie, simple bar/line)
-- p_series    set  -> grouped/stacked bars, multi-series lines
-- ============================================================
CREATE OR REPLACE FUNCTION chart_aggregate(
  p_source             text,
  p_measure            text,
  p_operation          text,
  p_dimension          text DEFAULT NULL,
  p_granularity        text DEFAULT 'month',
  p_series             text DEFAULT NULL,
  p_series_granularity text DEFAULT 'month',
  p_date_column        text DEFAULT NULL,
  p_from               timestamptz DEFAULT NULL,
  p_to                 timestamptz DEFAULT NULL,
  p_order_by           text DEFAULT 'bucket',
  p_limit              integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
-- SECURITY INVOKER (default): the caller's RLS policies apply to every
-- statement executed below. Do NOT change this to SECURITY DEFINER.
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_table       text;
  v_account_col text;

  v_measure_col      text;
  v_measure_is_count boolean;

  v_dim_col     text;
  v_dim_kind    text;
  v_dim_rel     text;
  v_dim_rel_lbl text;

  v_ser_col     text;
  v_ser_kind    text;
  v_ser_rel     text;
  v_ser_rel_lbl text;

  v_date_col    text;

  v_agg_sql     text;
  v_dim_sql     text;
  v_ser_sql     text;
  v_join_sql    text := '';
  v_where_sql   text := ' WHERE true';
  v_order_sql   text;
  v_sql         text;
  v_result      jsonb;
  v_limit       integer;
BEGIN
  -- ---- resolve source (the catalog is the only identifier source) ----
  SELECT table_name, account_column
    INTO v_table, v_account_col
    FROM chart_sources
   WHERE source_key = p_source;

  IF v_table IS NULL THEN
    RAISE EXCEPTION 'chart_aggregate: unknown source %', p_source
      USING ERRCODE = '22023';
  END IF;

  -- ---- resolve measure ----
  SELECT column_name, (column_name IS NULL)
    INTO v_measure_col, v_measure_is_count
    FROM chart_measures
   WHERE source_key = p_source AND measure_key = p_measure;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'chart_aggregate: unknown measure % for source %',
      p_measure, p_source USING ERRCODE = '22023';
  END IF;

  -- ---- build the aggregate expression ----
  IF v_measure_is_count THEN
    -- COUNT(*) is the only meaningful aggregate over "the rows themselves".
    v_agg_sql := 'count(*)::numeric';
  ELSE
    v_agg_sql := CASE p_operation
      WHEN 'COUNT'               THEN format('count(base.%I)::numeric', v_measure_col)
      WHEN 'SUM'                 THEN format('coalesce(sum(base.%I), 0)::numeric', v_measure_col)
      WHEN 'AVG'                 THEN format('avg(base.%I)::numeric', v_measure_col)
      WHEN 'MIN'                 THEN format('min(base.%I)::numeric', v_measure_col)
      WHEN 'MAX'                 THEN format('max(base.%I)::numeric', v_measure_col)
      WHEN 'COUNT_UNIQUE_VALUES' THEN format('count(distinct base.%I)::numeric', v_measure_col)
      WHEN 'COUNT_EMPTY'         THEN format('count(*) FILTER (WHERE base.%I IS NULL)::numeric', v_measure_col)
      WHEN 'COUNT_NOT_EMPTY'     THEN format('count(*) FILTER (WHERE base.%I IS NOT NULL)::numeric', v_measure_col)
      ELSE NULL
    END;

    IF v_agg_sql IS NULL THEN
      RAISE EXCEPTION 'chart_aggregate: unsupported operation %', p_operation
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- ---- resolve primary dimension ----
  IF p_dimension IS NOT NULL THEN
    SELECT column_name, kind, relation_table, relation_label_column
      INTO v_dim_col, v_dim_kind, v_dim_rel, v_dim_rel_lbl
      FROM chart_dimensions
     WHERE source_key = p_source AND dimension_key = p_dimension;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'chart_aggregate: unknown dimension % for source %',
        p_dimension, p_source USING ERRCODE = '22023';
    END IF;

    IF v_dim_kind = 'uuid' THEN
      v_join_sql := v_join_sql || format(
        ' LEFT JOIN %I d0 ON d0.id = base.%I', v_dim_rel, v_dim_col
      );
      v_dim_sql := format('coalesce(d0.%I::text, base.%I::text)',
                          v_dim_rel_lbl, v_dim_col);
    ELSE
      v_dim_sql := chart_dimension_expression(
        'base', v_dim_col, v_dim_kind, p_granularity
      );
    END IF;
  END IF;

  -- ---- resolve series (secondary) dimension ----
  IF p_series IS NOT NULL THEN
    SELECT column_name, kind, relation_table, relation_label_column
      INTO v_ser_col, v_ser_kind, v_ser_rel, v_ser_rel_lbl
      FROM chart_dimensions
     WHERE source_key = p_source AND dimension_key = p_series;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'chart_aggregate: unknown series dimension % for source %',
        p_series, p_source USING ERRCODE = '22023';
    END IF;

    IF v_ser_kind = 'uuid' THEN
      v_join_sql := v_join_sql || format(
        ' LEFT JOIN %I d1 ON d1.id = base.%I', v_ser_rel, v_ser_col
      );
      v_ser_sql := format('coalesce(d1.%I::text, base.%I::text)',
                          v_ser_rel_lbl, v_ser_col);
    ELSE
      v_ser_sql := chart_dimension_expression(
        'base', v_ser_col, v_ser_kind, p_series_granularity
      );
    END IF;
  END IF;

  -- ---- optional date-range filter ----
  IF p_from IS NOT NULL OR p_to IS NOT NULL THEN
    IF p_date_column IS NOT NULL THEN
      -- Must still be a catalogued *date* dimension of this source.
      SELECT column_name INTO v_date_col
        FROM chart_dimensions
       WHERE source_key = p_source
         AND dimension_key = p_date_column
         AND kind = 'date';

      IF v_date_col IS NULL THEN
        RAISE EXCEPTION 'chart_aggregate: % is not a date dimension of %',
          p_date_column, p_source USING ERRCODE = '22023';
      END IF;
    ELSE
      SELECT default_date_column INTO v_date_col
        FROM chart_sources WHERE source_key = p_source;
    END IF;

    IF v_date_col IS NOT NULL THEN
      -- p_from / p_to are already typed timestamptz, so %L renders a safe
      -- literal — no user text reaches the statement.
      IF p_from IS NOT NULL THEN
        v_where_sql := v_where_sql
          || format(' AND base.%I >= %L::timestamptz', v_date_col, p_from);
      END IF;
      IF p_to IS NOT NULL THEN
        v_where_sql := v_where_sql
          || format(' AND base.%I < %L::timestamptz', v_date_col, p_to);
      END IF;
    END IF;
  END IF;

  -- ---- defence-in-depth tenant filter (RLS is the real guard) ----
  -- Written null-safely: if the profile lookup yields nothing the
  -- predicate collapses to TRUE rather than silently emptying the chart,
  -- because RLS has already constrained the visible rows.
  IF v_account_col IS NOT NULL THEN
    v_where_sql := v_where_sql || format(
      ' AND base.%I = coalesce('
      || '(SELECT account_id FROM profiles WHERE user_id = auth.uid() LIMIT 1)'
      || ', base.%I)',
      v_account_col, v_account_col
    );
  END IF;

  v_limit := least(greatest(coalesce(p_limit, 50), 1), 500);

  -- Pie charts want the biggest slice first; time series want chronology.
  v_order_sql := CASE
    WHEN p_order_by = 'valueDesc' THEN 'val DESC NULLS LAST'
    WHEN p_order_by = 'valueAsc'  THEN 'val ASC NULLS LAST'
    WHEN p_order_by = 'bucketDesc' THEN 'sort_key DESC NULLS LAST'
    ELSE 'sort_key ASC NULLS LAST'
  END;

  -- ---- assemble ----
  IF p_dimension IS NULL THEN
    v_sql := format(
      'SELECT jsonb_build_array(jsonb_build_object('
      || '%L, NULL::text, %L, NULL::text, %L, coalesce(%s, 0)))'
      || ' FROM %I base%s%s',
      'bucket', 'series', 'value',
      v_agg_sql, v_table, v_join_sql, v_where_sql
    );
  ELSIF p_series IS NULL THEN
    v_sql := format(
      'SELECT coalesce(jsonb_agg('
      || 'jsonb_build_object(%L, sub.sort_key, %L, NULL::text, %L, sub.val)'
      || ' ORDER BY sub.%s), ''[]''::jsonb) FROM ('
      || ' SELECT %s AS sort_key, %s AS val'
      || ' FROM %I base%s%s'
      || ' GROUP BY %s'
      || ' ORDER BY %s'
      || ' LIMIT %s'
      || ') sub',
      'bucket', 'series', 'value',
      v_order_sql,
      v_dim_sql, v_agg_sql,
      v_table, v_join_sql, v_where_sql,
      v_dim_sql,
      v_order_sql,
      v_limit
    );
  ELSE
    v_sql := format(
      'SELECT coalesce(jsonb_agg('
      || 'jsonb_build_object(%L, sub.sort_key, %L, sub.series_key, %L, sub.val)'
      || ' ORDER BY sub.%s, sub.series_key), ''[]''::jsonb) FROM ('
      || ' SELECT %s AS sort_key, %s AS series_key, %s AS val'
      || ' FROM %I base%s%s'
      || ' GROUP BY %s, %s'
      || ' ORDER BY %s, series_key'
      || ' LIMIT %s'
      || ') sub',
      'bucket', 'series', 'value',
      v_order_sql,
      v_dim_sql, v_ser_sql, v_agg_sql,
      v_table, v_join_sql, v_where_sql,
      v_dim_sql, v_ser_sql,
      v_order_sql,
      v_limit
    );
  END IF;

  EXECUTE v_sql INTO v_result;

  RETURN coalesce(v_result, '[]'::jsonb);
END;
$$;

-- Postgres grants EXECUTE to PUBLIC by default on new functions, and anon
-- inherits from PUBLIC — so revoking from anon alone is not enough. Revoke
-- from PUBLIC first, then grant back only to authenticated.
REVOKE ALL ON FUNCTION chart_aggregate(
  text, text, text, text, text, text, text, text,
  timestamptz, timestamptz, text, integer
) FROM PUBLIC, anon;

REVOKE ALL ON FUNCTION chart_dimension_expression(text, text, text, text)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION chart_aggregate(
  text, text, text, text, text, text, text, text,
  timestamptz, timestamptz, text, integer
) TO authenticated;

GRANT EXECUTE ON FUNCTION chart_dimension_expression(text, text, text, text)
  TO authenticated;
