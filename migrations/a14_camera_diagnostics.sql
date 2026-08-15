-- ============================================================================
-- Sprint A.14 — Kameradiagnostik i heartbeaten
-- Körs i Supabase SQL Editor FÖRE deploy av den nya bundlen.
-- Additiv: befintliga rader får NULL och driftstatus fungerar som förut.
-- ============================================================================

alter table public.kiosk_heartbeats
  add column if not exists camera_state      text,
  add column if not exists camera_detail     text,
  add column if not exists camera_resolution text,
  add column if not exists camera_label      text,
  add column if not exists models_loaded     boolean,
  add column if not exists secure_context    boolean,
  add column if not exists webview_version   smallint,
  add column if not exists last_face_at      timestamptz;

comment on column public.kiosk_heartbeats.camera_state is
  'ok | denied | notfound | insecure | unsupported | error | pending. Sett genom appens ögon, inte Fully Kiosks.';

comment on column public.kiosk_heartbeats.camera_detail is
  'Feldetalj, normalt DOMException.name från getUserMedia (NotAllowedError, NotReadableError, ...).';

comment on column public.kiosk_heartbeats.camera_resolution is
  'Faktisk videoupplösning, t.ex. 320x240. NULL om strömmen aldrig startade.';

comment on column public.kiosk_heartbeats.camera_label is
  'Kamerans etikett från MediaStreamTrack. Tom i vissa WebViews även när allt fungerar.';

comment on column public.kiosk_heartbeats.models_loaded is
  'Om face-api-modellerna hunnit laddas. False + camera_state=ok betyder nätverks- eller assetproblem, inte kameraproblem.';

comment on column public.kiosk_heartbeats.secure_context is
  'window.isSecureContext. False förklarar tyst kamerafel: Fully Kiosks webbkameraåtkomst kräver HTTPS-ursprung.';

comment on column public.kiosk_heartbeats.webview_version is
  'Chromium-major ur user agent. Under 87 klarar plattan inte modellerna.';

comment on column public.kiosk_heartbeats.last_face_at is
  'Senaste gången ett ansikte faktiskt klassificerades. Skiljer "kameran trasig" från "ingen har stått framför den".';

alter table public.kiosk_heartbeats
  drop constraint if exists kiosk_heartbeats_camera_state_check;
alter table public.kiosk_heartbeats
  add constraint kiosk_heartbeats_camera_state_check
  check (camera_state is null or camera_state in
    ('ok','denied','notfound','insecure','unsupported','error','pending'));

-- Verifiering efter körning:
--   select touchpoint_id, last_seen_at, camera_state, camera_detail,
--          camera_resolution, models_loaded, secure_context, webview_version, last_face_at
--   from public.kiosk_heartbeats
--   order by last_seen_at desc;
