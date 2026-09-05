-- Atlas customer design intake: drop the per-session QR system.
--
-- The kiosk no longer generates a QR code per session. The QR code on the
-- kiosk is physical and permanent and always points at /session, so a
-- submission is no longer tied to a session — each one is simply its own row
-- with its own id.
--
-- Safe to run: atlas_kiosk_sessions exists only to support the removed dynamic
-- QR flow, and both tables were introduced by migration 002 for this feature.
-- Check before running if you are unsure:
--   SELECT count(*) FROM atlas_kiosk_sessions;
--   SELECT count(*) FROM atlas_design_requests WHERE session_id IS NOT NULL;

-- 1. Detach design requests from kiosk sessions.
ALTER TABLE atlas_design_requests
  DROP CONSTRAINT IF EXISTS atlas_design_requests_session_id_fkey;

DROP INDEX IF EXISTS idx_atlas_design_requests_session_id;

ALTER TABLE atlas_design_requests
  DROP COLUMN IF EXISTS session_id;

-- 2. The kiosk session table has no remaining purpose.
DROP TABLE IF EXISTS atlas_kiosk_sessions;

-- 3. The kiosk polls for the oldest pending request, so index that path.
CREATE INDEX IF NOT EXISTS idx_atlas_design_requests_pending_queue
  ON atlas_design_requests(status, created_at);

SELECT 'Kiosk session system removed; design requests are now standalone' AS status;
