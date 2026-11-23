-- 0173 -- W71: drop the copy taken before the G2 purge (23 Nov 2026)
--
-- purge_backup_20261029 held the test data as it was just before the purge of
-- 29 Oct 2026 (G2): 67 tables, about 1 MB, nothing outside it depending on it
-- (only its own TOAST tables). It was kept "until go-live settles"; the site has
-- been live since 12 Nov and Lawrence gave the go on 23 Nov. It was never made
-- by a migration, so on a fresh database this does nothing.

drop schema if exists purge_backup_20261029 cascade;
