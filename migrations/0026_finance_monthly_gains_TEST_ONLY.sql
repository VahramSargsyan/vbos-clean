-- FINANCE-MONTH-04: additive independent TEST-only monthly-gains writer.
-- No migration of Google BusinessMonthlyGains. Does not post to finance ledger.
-- Exact review/backup/readback required before applying to shared Clean TEST.
CREATE TABLE IF NOT EXISTS public.mvp_business_monthly_gains (
  month_key text PRIMARY KEY
    CHECK (month_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  referral_commission_base numeric(15,2) NOT NULL DEFAULT 0
    CHECK (referral_commission_base >= 0 AND referral_commission_base <= 999999999.99),
  purchase_commission_base numeric(15,2) NOT NULL DEFAULT 0
    CHECK (purchase_commission_base >= 0 AND purchase_commission_base <= 999999999.99),
  organization_margin_base numeric(15,2) NOT NULL DEFAULT 0
    CHECK (organization_margin_base >= 0 AND organization_margin_base <= 999999999.99),
  tax_optimization_savings_base numeric(15,2) NOT NULL DEFAULT 0
    CHECK (tax_optimization_savings_base >= 0 AND tax_optimization_savings_base <= 999999999.99),
  other_business_income_base numeric(15,2) NOT NULL DEFAULT 0
    CHECK (other_business_income_base >= 0 AND other_business_income_base <= 999999999.99),
  total_business_gains_base numeric(18,2) GENERATED ALWAYS AS
   (referral_commission_base+purchase_commission_base+organization_margin_base+
    tax_optimization_savings_base+other_business_income_base) STORED,
  notes text NOT NULL DEFAULT '' CHECK (length(notes)<=2000),
  revision integer NOT NULL DEFAULT 1 CHECK (revision>=1),
  source_system text NOT NULL DEFAULT 'CLEAN_TEST_MONTHLY_ONLY'
    CHECK(source_system='CLEAN_TEST_MONTHLY_ONLY'),
  last_request_key uuid NOT NULL,
  last_payload_sha256 text NOT NULL CHECK (last_payload_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.mvp_business_monthly_gain_requests (
  request_key uuid PRIMARY KEY,
  month_key text NOT NULL REFERENCES public.mvp_business_monthly_gains(month_key)
    ON DELETE RESTRICT,
  payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_revision integer NOT NULL CHECK(recorded_revision>=1),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mvp_business_monthly_gain_requests_month_idx
 ON public.mvp_business_monthly_gain_requests(month_key,created_at DESC);
