-- Let the template decide which questions get a card, for films that never
-- decided for themselves.
--
-- `config.questionPrompts` lists the questions that get an on-screen card
-- before the answer. An EMPTY list means "no card for any question", and that
-- is exactly what it meant — but nothing ever chose it. Browser capture wrote
-- `{ questionPrompts: [] }` at project creation and intake defaulted to `[]`,
-- so every film ever made carried an explicit instruction to show no
-- questions, and nobody watching one could tell what was being asked.
--
-- The column is optional now: absent means "whatever the template says", and
-- an explicit `[]` still means none. This removes the key from the projects
-- that never picked it, so they fall through to the template.
--
-- Deliberately NOT `= '[]'::jsonb OR IS NULL` across the board: three intake
-- projects carry ["love_lesson","closing_message"], which somebody typed into
-- incoming/project.json on purpose. Those are a choice and are left alone.
UPDATE projects
   SET config = config - 'questionPrompts'
 WHERE config -> 'questionPrompts' = '[]'::jsonb;
