-- The 20260830114000_add_account_issuer migration backfilled every account's
-- issuer as 'local:' || provider_id. That format is only correct for Better
-- Auth's LOCAL methods (e.g. "credential"); OAuth providers get a distinct
-- 'local:oauth:' || provider_id namespace (see @better-auth/core's
-- createOAuthAccountIssuer). Google accounts backfilled with the wrong prefix
-- can no longer be found by a fresh sign-in's account lookup, which then
-- tries to re-link them and fails on the (provider_id, account_id) unique
-- constraint — surfacing to users as a Google sign-in error
-- ("unable_to_link_account"). Re-stamp only the rows the old backfill wrote
-- (newly-linked Google accounts already carry the correct value and must not
-- be touched).
UPDATE "accounts"
SET "issuer" = 'local:oauth:' || "provider_id"
WHERE "provider_id" = 'google'
  AND "issuer" = 'local:' || "provider_id";
