-- ============================================================================
-- Sprint A.12 — Demografi: rå ålder och detektionskonfidens
-- Körs i Supabase SQL Editor FÖRE deploy av den nya bundlen.
-- Additiv och bakåtkompatibel: befintliga rader får NULL och fortsätter
-- fungera i alla vyer via roll-up till de fyra gamla åldersgrupperna.
-- ============================================================================

alter table public.responses
  add column if not exists raw_age         smallint,
  add column if not exists face_confidence real;

comment on column public.responses.raw_age is
  'Avrundad åldersskattning från face-api. NULL för svar utan ansiktsdetektion eller insamlade före sprint A.12.';

comment on column public.responses.face_confidence is
  'Detektionens score 0-1 från TinyFaceDetector. Demografivyn kräver >= 0.50.';

-- Sanity: rimlighetsgränser så uppenbart trasiga värden aldrig når rapporten.
alter table public.responses
  drop constraint if exists responses_raw_age_range;
alter table public.responses
  add constraint responses_raw_age_range
  check (raw_age is null or (raw_age >= 0 and raw_age <= 120));

alter table public.responses
  drop constraint if exists responses_face_confidence_range;
alter table public.responses
  add constraint responses_face_confidence_range
  check (face_confidence is null or (face_confidence >= 0 and face_confidence <= 1));

-- Verifiering efter körning:
--   select count(*) filter (where raw_age is not null)         as med_alder,
--          count(*) filter (where face_confidence is not null) as med_konfidens,
--          count(*)                                            as totalt
--   from public.responses;
