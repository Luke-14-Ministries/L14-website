-- 0088: the Creed agreement, version 3 (Lawrence, 14 Oct 2026).
--
-- Version 2 (0081) opened with "...we ask that all volunteers affirm the
-- Apostles' Creed. If you are uncomfortable doing that, please contact Larry
-- at larry@luke14ministries.net." The note under the tick box on the
-- volunteer application says the same thing, four lines lower -- found by the
-- 14 Oct test round. Lawrence: say it once, at the end. The framing sentence
-- keeps its first half; the tick-box note (in the form, not here) carries the
-- "speak with Larry".
--
-- A new VERSION, never an edit in place: a signature belongs to the words
-- that were on the screen when it was given (DECISIONS, 25 Aug). Version 2
-- is deactivated and its signatures stand. The Volunteers page counts a
-- signature on any version as "affirmed once" (14 Oct fix), so nobody's
-- history moves.

update public.agreements set active = false where key = 'apostles_creed' and version = 2;

insert into public.agreements (key, version, title, delivery, external_url, active, body)
select 'apostles_creed', 3, 'Affirmation of the Apostles'' Creed', 'internal_document', null, true,
       'We are running this camp in response to the instructions of Jesus Christ, and we ask that all volunteers affirm the Apostles'' Creed.' || E'\n\n' ||
       'I believe in God,' || E'\n' ||
       'the Father almighty,' || E'\n' ||
       'Creator of heaven and earth,' || E'\n' ||
       'and in Jesus Christ, his only Son, our Lord,' || E'\n' ||
       'who was conceived by the Holy Spirit,' || E'\n' ||
       'born of the Virgin Mary,' || E'\n' ||
       'suffered under Pontius Pilate,' || E'\n' ||
       'was crucified, died and was buried;' || E'\n' ||
       'he descended into hell;' || E'\n' ||
       'on the third day he rose again from the dead;' || E'\n' ||
       'he ascended into heaven,' || E'\n' ||
       'and is seated at the right hand of God the Father almighty;' || E'\n' ||
       'from there he will come to judge the living and the dead.' || E'\n\n' ||
       'I believe in the Holy Spirit,' || E'\n' ||
       'the holy catholic church,' || E'\n' ||
       'the communion of saints,' || E'\n' ||
       'the forgiveness of sins,' || E'\n' ||
       'the resurrection of the body,' || E'\n' ||
       'and life everlasting.' || E'\n\n' ||
       'Amen.'
where not exists (select 1 from public.agreements where key = 'apostles_creed' and version = 3);
