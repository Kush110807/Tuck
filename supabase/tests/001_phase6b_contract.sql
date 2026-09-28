begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(20);

select has_table('public', 'accounts', 'accounts exists');
select has_table('private', 'account_sync_heads', 'per-account head exists');
select has_table('private', 'sync_changes', 'change history exists');
select has_table('private', 'entity_tombstones', 'tombstones exist');
select has_table('private', 'processed_mutations', 'processed mutation store exists');
select has_table('private', 'bootstrap_sessions', 'bootstrap sessions exist');
select has_table('private', 'bootstrap_entries', 'bootstrap materialization exists');

select has_function('public', 'tuck_push_mutations', array['jsonb'], 'push RPC exists');
select has_function('public', 'tuck_pull_changes', array['jsonb'], 'pull RPC exists');
select has_function('public', 'tuck_bootstrap', array['jsonb'], 'bootstrap RPC exists');

select ok(not has_function_privilege('anon', 'public.tuck_push_mutations(jsonb)', 'EXECUTE'), 'anon cannot execute push');
select ok(has_function_privilege('authenticated', 'public.tuck_push_mutations(jsonb)', 'EXECUTE'), 'authenticated can execute push');
select ok(not has_table_privilege('authenticated', 'private.sync_changes', 'SELECT'), 'authenticated cannot directly read sync history');
select ok(not has_table_privilege('authenticated', 'private.processed_mutations', 'SELECT'), 'authenticated cannot directly read processed mutations');
select ok(not has_table_privilege('authenticated', 'public.items', 'INSERT'), 'authenticated cannot bypass push with direct item insert');

select ok((select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='items'), 'items RLS enabled');
select ok((select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='collections'), 'collections RLS enabled');
select ok((select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='assets'), 'assets RLS enabled');
select ok((select public is false from storage.buckets where id='tuck-assets'), 'asset bucket is private');
select has_column('public', 'accounts', 'change_retention_floor_seq', 'retention floor is explicit');

select * from finish();
rollback;
