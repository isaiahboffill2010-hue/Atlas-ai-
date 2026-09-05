-- Atlas customer design intake (Phase 1)
--
-- atlas_kiosk_sessions : one row per stretch of time the Atlas kiosk is showing
--                        a QR code. The id is what the QR code encodes.
-- atlas_design_requests: what a customer submitted from their phone for that
--                        session. Intake only — no generated design yet.

CREATE TABLE IF NOT EXISTS atlas_kiosk_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  -- Held only by the kiosk. The session id travels in the QR code and lets a
  -- customer WRITE a submission; reading submissions back additionally requires
  -- this token, so one customer can never read another customer's details.
  kiosk_token TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '12 hours')
);

CREATE TABLE IF NOT EXISTS atlas_design_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES atlas_kiosk_sessions(id) ON DELETE CASCADE,
  design_type TEXT NOT NULL CHECK (design_type IN ('business_card', 'flyer')),

  -- Shared customer information
  business_name TEXT NOT NULL,
  person_name TEXT,
  job_title TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  address TEXT,
  social_media TEXT,
  additional_information TEXT,

  -- What the customer asked the design to look like, in their own words
  design_instructions TEXT,

  -- Flyer-only fields ({ main_title, description }); NULL for business cards
  flyer_details JSONB,

  -- Storage keys in the atlas-library bucket under design-requests/.
  -- customer_qr_file_reference is the QR code the CUSTOMER uploaded to be
  -- printed on their design. It is unrelated to the kiosk's session QR code,
  -- which is generated on the fly and never stored.
  logo_file_reference TEXT,
  customer_qr_file_reference TEXT,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'received', 'processing', 'completed', 'failed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_atlas_kiosk_sessions_active
  ON atlas_kiosk_sessions(status, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_atlas_design_requests_session_id
  ON atlas_design_requests(session_id);

CREATE INDEX IF NOT EXISTS idx_atlas_design_requests_status
  ON atlas_design_requests(status);

CREATE INDEX IF NOT EXISTS idx_atlas_design_requests_created_at
  ON atlas_design_requests(created_at DESC);

-- Keep updated_at current on design requests
CREATE OR REPLACE FUNCTION update_atlas_design_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_atlas_design_requests_updated_at ON atlas_design_requests;
CREATE TRIGGER trigger_atlas_design_requests_updated_at
BEFORE UPDATE ON atlas_design_requests
FOR EACH ROW
EXECUTE FUNCTION update_atlas_design_requests_updated_at();

-- Row Level Security: everything goes through the server with the service role
-- key, so no anon/authenticated policies are granted. Customers never talk to
-- Postgres or Storage directly.
ALTER TABLE atlas_kiosk_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE atlas_design_requests ENABLE ROW LEVEL SECURITY;

GRANT ALL ON atlas_kiosk_sessions TO service_role;
GRANT ALL ON atlas_design_requests TO service_role;

SELECT 'Atlas kiosk sessions and design requests tables created successfully' AS status;
