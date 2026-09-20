-- Rebrand to INX SMS (INXAPP Limited): the accounts move off the old placeholder domain.
-- Staff were <name>@pensms.test and students <name>@student.pensms.test; both now end in
-- @sms.inxapp.net, matching prisma/d1/seed.ts.
--
-- Suffix arithmetic rather than a list of the six seeded rows, so it also covers any student
-- enrolled through the app since the database was seeded.
--
-- Safe to re-run: after it has run no row matches either pattern, and on a database seeded from
-- the current seed there is nothing to match to begin with, so it is a no-op there.
--
-- "User"."email" is UNIQUE. No collision is possible: the two suffixes never share a local part
-- (the only staff account is "registry", and no student is called that).
--
-- The student rule runs first for clarity only; '%@pensms.test' cannot match a student address,
-- whose suffix is preceded by '.', not '@'.

UPDATE "User"
SET "email" = substr("email", 1, length("email") - length('@student.pensms.test')) || '@sms.inxapp.net'
WHERE "email" LIKE '%@student.pensms.test';

UPDATE "User"
SET "email" = substr("email", 1, length("email") - length('@pensms.test')) || '@sms.inxapp.net'
WHERE "email" LIKE '%@pensms.test';
