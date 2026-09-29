begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(38);

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
select ok(exists (
  select 1 from pg_policies
  where schemaname='storage' and tablename='objects' and policyname='tuck_assets_insert_own'
    and with_check like '%auth.uid()%'
), 'Storage insert policy is tied to authenticated user prefix');
select has_column('public', 'accounts', 'change_retention_floor_seq', 'retention floor is explicit');

-- P6B-02: the hardened definer role is deliberately non-login and has no
-- residual members after migration finalization.
select ok(exists (
  select 1 from pg_roles
  where rolname='tuck_rpc_owner'
    and not rolcanlogin
    and not rolinherit
    and rolbypassrls
    and not rolsuper
    and not rolcreatedb
    and not rolcreaterole
    and not rolreplication
), 'tuck_rpc_owner keeps exact hardened non-login attributes');

-- P6B-04: SECURITY DEFINER RPCs call schema-qualified auth.uid(). The owner
-- needs schema USAGE, but no auth table access or client-role membership.
select ok(
  has_schema_privilege('tuck_rpc_owner', 'auth', 'USAGE'),
  'tuck_rpc_owner has only the required auth schema USAGE boundary'
);

select ok(
  has_function_privilege('tuck_rpc_owner', 'auth.uid()', 'EXECUTE'),
  'tuck_rpc_owner can execute auth.uid()'
);

select ok(
  not has_table_privilege('tuck_rpc_owner', 'auth.users', 'SELECT')
  and not has_table_privilege('tuck_rpc_owner', 'auth.users', 'INSERT')
  and not has_table_privilege('tuck_rpc_owner', 'auth.users', 'UPDATE')
  and not has_table_privilege('tuck_rpc_owner', 'auth.users', 'DELETE')
  and not has_table_privilege('tuck_rpc_owner', 'auth.users', 'TRUNCATE')
  and not has_table_privilege('tuck_rpc_owner', 'auth.users', 'REFERENCES')
  and not has_table_privilege('tuck_rpc_owner', 'auth.users', 'TRIGGER'),
  'tuck_rpc_owner has no auth.users table privileges'
);

select ok(not exists (
  select 1
  from pg_auth_members m
  join pg_roles owner_role on owner_role.oid=m.roleid
  join pg_roles member_role on member_role.oid=m.member
  where owner_role.rolname='tuck_rpc_owner'
    and member_role.rolname in ('anon','authenticated')
), 'anon/authenticated are not members of tuck_rpc_owner');

select ok(not exists (
  select 1 from pg_auth_members m
  join pg_roles r on r.oid=m.roleid
  where r.rolname='tuck_rpc_owner'
), 'tuck_rpc_owner has no residual role members');

select ok(not exists (
  select 1 from pg_roles
  where rolname in ('anon','authenticated') and rolbypassrls
), 'client roles do not receive BYPASSRLS');

select is((
  select count(*)::integer
  from (values
    ('public.tuck_push_mutations(jsonb)'),
    ('public.tuck_pull_changes(jsonb)'),
    ('public.tuck_bootstrap(jsonb)'),
    ('public.tuck_request_account_deletion()'),
    ('public.tuck_create_asset_staging(text,text,bigint)'),
    ('public.tuck_finalize_asset(text,text)'),
    ('private.initialize_tuck_account()')
  ) expected(signature)
  where to_regprocedure(expected.signature) is not null
), 7, 'all seven hardened SECURITY DEFINER functions exist');

select ok(not exists (
  select 1
  from (values
    ('public.tuck_push_mutations(jsonb)'),
    ('public.tuck_pull_changes(jsonb)'),
    ('public.tuck_bootstrap(jsonb)'),
    ('public.tuck_request_account_deletion()'),
    ('public.tuck_create_asset_staging(text,text,bigint)'),
    ('public.tuck_finalize_asset(text,text)'),
    ('private.initialize_tuck_account()')
  ) expected(signature)
  join pg_proc p on p.oid=to_regprocedure(expected.signature)
  where pg_get_userbyid(p.proowner) <> 'tuck_rpc_owner'
), 'every hardened function is owned by tuck_rpc_owner');

select ok(not exists (
  select 1
  from (values
    ('public.tuck_push_mutations(jsonb)'),
    ('public.tuck_pull_changes(jsonb)'),
    ('public.tuck_bootstrap(jsonb)'),
    ('public.tuck_request_account_deletion()'),
    ('public.tuck_create_asset_staging(text,text,bigint)'),
    ('public.tuck_finalize_asset(text,text)'),
    ('private.initialize_tuck_account()')
  ) expected(signature)
  join pg_proc p on p.oid=to_regprocedure(expected.signature)
  where not p.prosecdef
), 'every hardened function remains SECURITY DEFINER');

select ok(not exists (
  select 1
  from (values
    ('public.tuck_push_mutations(jsonb)', 'search_path=pg_catalog, public, private'),
    ('public.tuck_pull_changes(jsonb)', 'search_path=pg_catalog, public, private'),
    ('public.tuck_bootstrap(jsonb)', 'search_path=pg_catalog, public, private, extensions'),
    ('public.tuck_request_account_deletion()', 'search_path=pg_catalog, public'),
    ('public.tuck_create_asset_staging(text,text,bigint)', 'search_path=pg_catalog, public, private'),
    ('public.tuck_finalize_asset(text,text)', 'search_path=pg_catalog, public, private, storage'),
    ('private.initialize_tuck_account()', 'search_path=pg_catalog, public, private')
  ) expected(signature, expected_search_path)
  join pg_proc p on p.oid=to_regprocedure(expected.signature)
  where coalesce(array_length(p.proconfig,1),0) <> 1
     or p.proconfig[1] <> expected.expected_search_path
), 'every hardened function keeps its exact fixed search_path');

select ok(not exists (
  select 1
  from (values
    ('public.tuck_push_mutations(jsonb)'),
    ('public.tuck_pull_changes(jsonb)'),
    ('public.tuck_bootstrap(jsonb)'),
    ('public.tuck_request_account_deletion()'),
    ('public.tuck_create_asset_staging(text,text,bigint)'),
    ('public.tuck_finalize_asset(text,text)')
  ) expected(signature)
  join pg_proc p on p.oid=to_regprocedure(expected.signature)
  where pg_get_functiondef(p.oid) not like '%auth.uid()%'
), 'all public hardened RPCs derive caller identity from auth.uid()');

select ok(not exists (
  select 1
  from (values
    ('public.tuck_push_mutations(jsonb)'),
    ('public.tuck_pull_changes(jsonb)'),
    ('public.tuck_bootstrap(jsonb)'),
    ('public.tuck_request_account_deletion()'),
    ('public.tuck_create_asset_staging(text,text,bigint)'),
    ('public.tuck_finalize_asset(text,text)')
  ) expected(signature)
  where not has_function_privilege('authenticated', expected.signature, 'EXECUTE')
), 'authenticated can execute every intended public hardened RPC');

select ok(not exists (
  select 1
  from (values
    ('public.tuck_push_mutations(jsonb)'),
    ('public.tuck_pull_changes(jsonb)'),
    ('public.tuck_bootstrap(jsonb)'),
    ('public.tuck_request_account_deletion()'),
    ('public.tuck_create_asset_staging(text,text,bigint)'),
    ('public.tuck_finalize_asset(text,text)')
  ) expected(signature)
  where has_function_privilege('anon', expected.signature, 'EXECUTE')
), 'anon cannot execute any hardened public RPC');

select ok(not exists (
  select 1
  from (values
    ('public.tuck_push_mutations(jsonb)'),
    ('public.tuck_pull_changes(jsonb)'),
    ('public.tuck_bootstrap(jsonb)'),
    ('public.tuck_request_account_deletion()'),
    ('public.tuck_create_asset_staging(text,text,bigint)'),
    ('public.tuck_finalize_asset(text,text)')
  ) expected(signature)
  join pg_proc p on p.oid=to_regprocedure(expected.signature)
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
  where acl.grantee=0 and acl.privilege_type='EXECUTE'
), 'PUBLIC execute is revoked from all hardened public RPCs');

select ok(
  not has_function_privilege('anon', 'private.initialize_tuck_account()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.initialize_tuck_account()', 'EXECUTE'),
  'client roles cannot execute the private account initializer'
);

select ok(has_function_privilege('tuck_rpc_owner', 'private.initialize_tuck_account()', 'EXECUTE'),
  'tuck_rpc_owner can execute private helpers it owns');

select * from finish();
rollback;
