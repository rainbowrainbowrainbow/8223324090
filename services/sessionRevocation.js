'use strict';

// UPDATE evaluates this against the locked user row. Even if the database clock
// moves backwards, a revoked legacy JWT must never become valid again. Advance
// by at least one PostgreSQL microsecond so each revoke also changes the cutoff
// bound into newly issued tokens.
const SESSION_REVOCATION_CUTOFF_SQL = "GREATEST(clock_timestamp(), session_revoked_at + INTERVAL '1 microsecond')";

module.exports = { SESSION_REVOCATION_CUTOFF_SQL };
