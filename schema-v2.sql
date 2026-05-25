-- Migration v2: security hardening
-- Correr en Supabase → SQL Editor

-- ── 1. Nuevas columnas ────────────────────────────────────────────────────────
ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS ai_calls_today  INT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_calls_date   DATE DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS created_ip      TEXT;

-- ── 2. RLS — bloquear acceso con clave anónima ────────────────────────────────
-- PROBLEMA: la política anterior (USING true sin rol) dejaba que cualquiera
-- con la anon key de Supabase leyera y escribiera toda la tabla licenses.
-- FIX: solo el service_role (usado en tus funciones serverless) tiene acceso.

DROP POLICY IF EXISTS "service_full_access"   ON licenses;
DROP POLICY IF EXISTS "block_anon"            ON licenses;
DROP POLICY IF EXISTS "block_authenticated"   ON licenses;
DROP POLICY IF EXISTS "service_role_only"     ON licenses;

-- Solo service_role puede leer/escribir
CREATE POLICY "service_role_only" ON licenses
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Anon key: sin acceso
CREATE POLICY "block_anon" ON licenses
  TO anon
  USING (false);

-- Usuarios autenticados normales: sin acceso
CREATE POLICY "block_authenticated" ON licenses
  TO authenticated
  USING (false);
