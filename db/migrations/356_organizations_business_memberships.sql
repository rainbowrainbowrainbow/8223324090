-- MIGRATION_KIND: schema
-- SAFETY: Additive/idempotent multi-business foundation. It creates empty organization and membership tables only; no existing user roles, business_contexts, bookings, finance, or product data are changed.
-- OPERATOR_APPROVAL: required for bootstrap/cutover; this schema migration alone does not assign ownership.
-- ROLLBACK: Drop business_memberships, organization_memberships, businesses, and organizations only after exporting any organization configuration and memberships created after this migration.

CREATE TABLE IF NOT EXISTS organizations (
    id BIGSERIAL PRIMARY KEY,
    slug VARCHAR(80) NOT NULL,
    name VARCHAR(160) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT organizations_slug_unique UNIQUE (slug),
    CONSTRAINT organizations_status_check CHECK (status IN ('active', 'inactive'))
);

CREATE TABLE IF NOT EXISTS businesses (
    id BIGSERIAL PRIMARY KEY,
    organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    context_key VARCHAR(64) NOT NULL,
    label VARCHAR(160) NOT NULL,
    short_label VARCHAR(80) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'active',
    access_mode VARCHAR(16) NOT NULL DEFAULT 'compatibility',
    modules JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT businesses_context_unique UNIQUE (context_key),
    CONSTRAINT businesses_status_check CHECK (status IN ('active', 'inactive')),
    CONSTRAINT businesses_access_mode_check CHECK (access_mode IN ('compatibility', 'membership')),
    CONSTRAINT businesses_modules_array_check CHECK (jsonb_typeof(modules) = 'array')
);

CREATE TABLE IF NOT EXISTS organization_memberships (
    organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(16) NOT NULL DEFAULT 'member',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (organization_id, user_id),
    CONSTRAINT organization_memberships_role_check CHECK (role IN ('owner', 'admin', 'member'))
);

CREATE TABLE IF NOT EXISTS business_memberships (
    business_id BIGINT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    organization_id BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(64) NOT NULL,
    extra_roles TEXT[] NOT NULL DEFAULT '{}'::text[],
    page_allowlist TEXT[] NOT NULL DEFAULT '{}'::text[],
    page_denylist TEXT[] NOT NULL DEFAULT '{}'::text[],
    action_allowlist TEXT[] NOT NULL DEFAULT '{}'::text[],
    action_denylist TEXT[] NOT NULL DEFAULT '{}'::text[],
    is_default BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (business_id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_memberships_one_default_per_user_org
    ON business_memberships (user_id, organization_id)
    WHERE is_default IS TRUE AND is_active IS TRUE;

CREATE INDEX IF NOT EXISTS idx_organization_memberships_user_active
    ON organization_memberships (user_id, organization_id) WHERE is_active IS TRUE;
CREATE INDEX IF NOT EXISTS idx_businesses_organization_active
    ON businesses (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_business_memberships_user_active
    ON business_memberships (user_id, business_id) WHERE is_active IS TRUE;

CREATE OR REPLACE FUNCTION eventgenix_multibusiness_touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = clock_timestamp();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_organizations_updated_at ON organizations;
CREATE TRIGGER trg_organizations_updated_at BEFORE UPDATE ON organizations FOR EACH ROW EXECUTE FUNCTION eventgenix_multibusiness_touch_updated_at();
DROP TRIGGER IF EXISTS trg_businesses_updated_at ON businesses;
CREATE TRIGGER trg_businesses_updated_at BEFORE UPDATE ON businesses FOR EACH ROW EXECUTE FUNCTION eventgenix_multibusiness_touch_updated_at();
DROP TRIGGER IF EXISTS trg_organization_memberships_updated_at ON organization_memberships;
CREATE TRIGGER trg_organization_memberships_updated_at BEFORE UPDATE ON organization_memberships FOR EACH ROW EXECUTE FUNCTION eventgenix_multibusiness_touch_updated_at();
DROP TRIGGER IF EXISTS trg_business_memberships_updated_at ON business_memberships;
CREATE TRIGGER trg_business_memberships_updated_at BEFORE UPDATE ON business_memberships FOR EACH ROW EXECUTE FUNCTION eventgenix_multibusiness_touch_updated_at();

CREATE OR REPLACE FUNCTION eventgenix_multibusiness_validate_membership_organization() RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM businesses b
        WHERE b.id = NEW.business_id AND b.organization_id = NEW.organization_id
    ) THEN
        RAISE EXCEPTION 'Business membership organization does not match business';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_business_memberships_organization ON business_memberships;
CREATE TRIGGER trg_business_memberships_organization
    BEFORE INSERT OR UPDATE OF business_id, organization_id ON business_memberships
    FOR EACH ROW EXECUTE FUNCTION eventgenix_multibusiness_validate_membership_organization();
