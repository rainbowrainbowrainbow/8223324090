'use strict';

const { resolveEffectivePayrollProfile } = require('../services/payroll');

function activeOnDate(row, date) {
    const from = row.effectiveFrom || row.effective_from;
    const to = row.effectiveTo || row.effective_to;
    return (!from || from <= date) && (!to || to >= date);
}

function buildProfileContext(profiles, assignments, date) {
    const profilesById = new Map(profiles.map(profile => [Number(profile.id), {
        ...profile,
        versions: (profile.versions || []).map(version => ({
            ...version,
            dayRates: new Map((version.dayRates || version.day_rates || []).map(day => [Number(day.isoWeekday ?? day.iso_weekday), Number(day.rate)]))
        }))
    }]));
    const defaultProfilesByProfession = new Map();
    for (const profile of profilesById.values()) {
        if (profile.isDefaultForProfession || profile.is_default_for_profession) defaultProfilesByProfession.set(profile.professionKey || profile.profession_key, profile);
    }
    const assignmentsByStaffProfession = new Map();
    for (const assignment of assignments) {
        const staffId = Number(assignment.staffId || assignment.staff_id);
        const key = `${staffId}:${assignment.professionKey || assignment.profession_key}`;
        if (!assignmentsByStaffProfession.has(key)) assignmentsByStaffProfession.set(key, []);
        assignmentsByStaffProfession.get(key).push({ ...assignment, profile: profilesById.get(Number(assignment.profileId || assignment.profile_id)) });
    }
    return { enabled: true, from: date, to: date, profilesById, defaultProfilesByProfession, assignmentsByStaffProfession };
}

function buildHrPayReadiness({ staff = [], professions = [], profiles = [], assignments = [], date,
    profilesAvailable = false, assignmentsAvailable = false, catalogPartial = false, payrollAmountsAvailable = false,
    liveProof = null, sourceErrors = [] }) {
    if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date || '')
        || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) throw new Error('VALID_WORK_DATE_REQUIRED');
    const context = buildProfileContext(profiles, assignments, date);
    const roster = staff.filter(person => person.is_active !== false && person.isActive !== false);
    const catalog = new Map();
    for (const profession of professions) {
        for (const person of profession.people || []) catalog.set(`${Number(person.id)}:${profession.key}`, person);
    }
    const rows = [];
    for (const person of roster) {
        const staffId = Number(person.id);
        if (!Number.isSafeInteger(staffId) || staffId <= 0) continue;
        const primary = person.role_type || person.roleType;
        const secondary = Array.isArray(person.secondary_professions) ? person.secondary_professions : [];
        const keys = new Set([primary, ...secondary].filter(Boolean));
        for (const [key, catalogPerson] of catalog) if (Number(catalogPerson.id) === staffId) keys.add(key.slice(key.indexOf(':') + 1));
        for (const professionKey of keys) {
            const catalogPerson = catalog.get(`${staffId}:${professionKey}`);
            const isPrimary = professionKey === primary;
            const findings = [];
            const unknown = [];
            if (!catalogPerson) unknown.push('assignment_unverified');
            else {
                if (catalogPerson.isActive === false || catalogPerson.assignmentStatus !== 'active') findings.push('assignment_inactive');
                if (catalogPerson.admissionStatus !== 'approved') findings.push('admission_not_approved');
                if (!isPrimary) {
                    const unit = catalogPerson.rateUnit;
                    if (unit && unit !== 'hour') findings.push('rate_unit_conflict');
                    else if (unit === 'hour' && payrollAmountsAvailable) {
                        if (!(Number(catalogPerson.explicitRate) > 0)
                            || catalogPerson.rateSource !== 'staff_profession_rates.hourly_rate') findings.push('explicit_additional_rate_missing');
                    } else if (catalogPerson.hasExplicitHourlyRate !== true) unknown.push('explicit_additional_rate_unverified');
                }
            }
            let effectiveSource = null;
            let effectiveUnit = null;
            if (!profilesAvailable || !assignmentsAvailable) unknown.push('payroll_profile_unverified');
            else {
                const activeAssignments = (context.assignmentsByStaffProfession.get(`${staffId}:${professionKey}`) || []).filter(row => activeOnDate(row, date));
                for (const assignment of activeAssignments) {
                    const profile = assignment.profile;
                    if (!profile || profile.status !== 'active' || !(profile.versions || []).some(version => activeOnDate(version, date))) findings.push('payroll_profile_invalid');
                }
                const defaultProfile = context.defaultProfilesByProfession.get(professionKey);
                if (defaultProfile && (defaultProfile.status !== 'active' || !(defaultProfile.versions || []).some(version => activeOnDate(version, date)))) findings.push('payroll_profile_invalid');
                const resolution = resolveEffectivePayrollProfile(person, professionKey, date, {
                    payrollProfileContext: context, preferredRateUnit: isPrimary ? person.rate_unit || person.rateUnit || 'hour' : 'hour',
                    professionRateMap: new Map((person.profession_rates || []).map(rate => [`${staffId}:${rate.profession_key}`, Number(rate.hourly_rate)]))
                });
                effectiveSource = resolution.rateSource;
                effectiveUnit = resolution.rateUnit;
                if (!(resolution.rate > 0)) {
                    if (payrollAmountsAvailable) findings.push('effective_rate_missing');
                    else unknown.push('effective_rate_unverified');
                }
                if (!isPrimary && resolution.applies && resolution.rate > 0) findings.push('additional_profile_calculation_pending');
            }
            rows.push({ staffId, professionKey, use: isPrimary ? 'primary' : 'potential_additional',
                findings: [...new Set(findings)], unverified: [...new Set(unknown)], effectiveSource, effectiveUnit });
        }
    }
    const counts = {};
    for (const row of rows) for (const finding of row.findings) counts[finding] = (counts[finding] || 0) + 1;
    return {
        schemaVersion: 1, readOnly: true, date,
        status: catalogPartial || !profilesAvailable || !assignmentsAvailable || sourceErrors.length || rows.some(row => row.unverified.length) ? 'PARTIAL' : 'DATA_AUDIT_COMPLETE',
        purpose: 'Data configuration audit; not proof of release readiness or payroll correctness',
        liveProof,
        coverage: { staff: roster.length, staffProfessionPairs: rows.length, catalogPartial, payrollAmountsAvailable, profilesAvailable, assignmentsAvailable },
        counts, sourceErrors, rows,
        exclusions: ['one_day_exceptions_not_implemented', 'additional_day_and_month_formulas_not_implemented', 'no_salary_generation', 'no_payment_mutation'],
        interpretation: 'Potential additional roles are configuration checks, not claims that every employee needs an additional paid profession. No personal records or compensation amounts are saved.'
    };
}

module.exports = { activeOnDate, buildHrPayReadiness };
