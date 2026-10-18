#!/usr/bin/env bash
# Run the row-level security harness (supabase/migrations/rls_test.sql) against a
# throwaway database on the LOCAL PostgreSQL 16 -- never the Supabase project.
#
#   bash supabase/tests/run_rls_local.sh            # rls_test.sql
#   bash supabase/tests/run_rls_local.sh other.sql  # any test file after the migrations
#
# What it does, every time, from nothing:
#   1. drops and recreates the database l14_rls_test on localhost:5432;
#   2. makes sure the three Supabase roles exist (anon, authenticated,
#      service_role) -- they are cluster-wide, so this is a no-op after the first run;
#   3. runs supabase/tests/supabase_stubs.sql (auth.uid(), storage, grants);
#   4. runs every numbered migration in order, stopping at the first error;
#   5. runs the test file, stopping at the first FAIL.
#
# Logs in as postgres; the password comes from the standard psql password file
# (%APPDATA%\postgresql\pgpass.conf on Windows), which is outside this repository.
# Installed 17 Oct 2026 (PostgreSQL 16 via winget). Works from Git Bash.

set -euo pipefail
cd "$(dirname "$0")/../.."

PSQL="${PSQL:-/c/Program Files/PostgreSQL/16/bin/psql.exe}"
[ -x "$PSQL" ] || PSQL="$(command -v psql)"
DB=l14_rls_test
TEST="${1:-supabase/migrations/rls_test.sql}"
q() { "$PSQL" -h localhost -U postgres -v ON_ERROR_STOP=1 -q -X "$@"; }

echo "== fresh database $DB"
q -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB"

echo "== Supabase roles"
q -d postgres <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
SQL

echo "== stubs"
q -d "$DB" -f supabase/tests/supabase_stubs.sql

echo "== migrations"
n=0
for f in $(ls supabase/migrations/0*.sql | sort); do
  if ! q -d "$DB" -f "$f" > /dev/null 2> /tmp/l14_migration_err.txt; then
    echo "FAILED at $f"; cat /tmp/l14_migration_err.txt; exit 1
  fi
  n=$((n + 1))
done
echo "   $n migrations applied"

echo "== $TEST"
q -d "$DB" -f "$TEST"
echo "== done"
