-- Space MELI — Supabase Schema
CREATE TABLE licenses (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  key                 TEXT UNIQUE NOT NULL,
  email               TEXT NOT NULL,
  plan                TEXT DEFAULT 'monthly',
  active              BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  expires_at          TIMESTAMPTZ,
  stripe_customer_id  TEXT,
  stripe_session_id   TEXT,
  last_validated_at   TIMESTAMPTZ,
  notes               TEXT
);

CREATE INDEX idx_licenses_key   ON licenses (key);
CREATE INDEX idx_licenses_email ON licenses (email);

ALTER TABLE licenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_full_access" ON licenses
  USING (true)
  WITH CHECK (true);

CREATE VIEW licenses_summary AS
  SELECT
    key, email, plan, active,
    created_at::DATE AS fecha_compra,
    expires_at::DATE AS vence,
    last_validated_at::DATE AS ultimo_uso,
    CASE
      WHEN NOT active THEN 'Bloqueada'
      WHEN expires_at IS NOT NULL AND expires_at < NOW() THEN 'Vencida'
      ELSE 'Activa'
    END AS estado
  FROM licenses
  ORDER BY created_at DESC;
