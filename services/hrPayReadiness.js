'use strict';

const { resolvePayrollConditions, exceptionKey } = require('./hrPayrollConditions');

function activeOnDate(row, date) {
    const from = row.effectiveFrom ?? row.effective_from;
    const to = row.effectiveTo ?? row.effective_to;
    return (!from || from <= date) && (!to || to >= date);
}

function buildProfileContext(profiles, assignments, date) {
    const profilesById = new Map(profiles.map(profile => [Number(profile.id), {
        id: Number(profile.id), title: '', status: profile.status,
        professionKey: profile.professionKey ?? profile.profession_key,
        profileKind: profile.profileKind ?? profile.profile_kind,
        isDefaultForProfession: profile.isDefaultForProfession ?? profile.is_default_for_profession,
        versions: (profile.versions || []).map(version => ({
            id: Number(version.id), profileId: Number(profile.id),
            versionNumber: Number(version.versionNumber ?? version.version_number),
            rateUnit: version.rateUnit ?? version.rate_unit,
            defaultRate: Number(version.defaultRate ?? version.default_rate),
            effectiveFrom: version.effectiveFrom ?? version.effective_from,
            effectiveTo: version.effectiveTo ?? version.effective_to,
            dayRates: new Map((version.dayRates || version.day_rates || []).map(day =>
                [Number(day.isoWeekday ?? day.iso_weekday), Number(day.rate)]))
        }))
    }]));
    const defaultProfilesByProfession = new Map();
    for (const profile of profilesById.values()) {
        if (profile.isDefaultForProfession) defaultProfilesByProfession.set(profile.professionKey, profile);
    }
    const assignmentsByStaffProfession = new Map();
    for (const row of assignments) {
        const assignment = { id: Number(row.id), staffId: Number(row.staffId ?? row.staff_id),
            professionKey: row.professionKey ?? row.profession_key,
            assignmentKind: row.assignmentKind ?? row.assignment_kind,
            effectiveFrom: row.effectiveFrom ?? row.effective_from,
            effectiveTo: row.effectiveTo ?? row.effective_to,
            profile: profilesById.get(Number(row.profileId ?? row.profile_id)) };
        const key = `${assignment.staffId}:${assignment.professionKey}`;
        if (!assignmentsByStaffProfession.has(key)) assignmentsByStaffProfession.set(key, []);
        assignmentsByStaffProfession.get(key).push(assignment);
    }
    return { enabled: true, from: date, to: date, profilesById, defaultProfilesByProfession, assignmentsByStaffProfession };
}

function validateDate(date) {
    if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date || '')
        || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) throw new Error('VALID_WORK_DATE_REQUIRED');
    return date;
}

function buildHrPayReadiness({ staff = [], professions = [], profiles = [], assignments = [], date,
    rates = [], roleAssignments = [], exceptions = [], schemes = [],
    profilesAvailable = false, assignmentsAvailable = false, catalogPartial = false, payrollAmountsAvailable = false,
    legacyRatesAvailable = payrollAmountsAvailable, rolesAvailable = false, exceptionsAvailable = false,
    schemesAvailable = false, liveProof = null, sourceErrors = [], source = 'api' }) {
    validateDate(date);
    const roster = staff.filter(person => person.is_active !== false && person.isActive !== false);
    const profileContext = buildProfileContext(profiles, assignments, date);
    const catalog = new Map();
    for (const profession of professions) for (const person of profession.people || []) {
        catalog.set(`${Number(person.id)}:${profession.key}`, person);
    }
    const rateMap = new Map(rates.map(row => [`${row.staff_id}:${row.profession_key}`, Number(row.hourly_rate)]));
    const roleMap = new Map(roleAssignments.map(row => [`${row.staff_id}:${row.profession_key}`, row]));
    for (const person of roster) for (const rate of person.profession_rates || []) {
        rateMap.set(`${person.id}:${rate.profession_key}`, Number(rate.hourly_rate));
    }
    for (const [key, person] of catalog) {
        if (!rolesAvailable) roleMap.set(key, { status: person.assignmentStatus, admission_status: person.admissionStatus });
        if (person.rateSource === 'staff_profession_rates.hourly_rate' && person.explicitRate != null) rateMap.set(key, Number(person.explicitRate));
    }
    const context = { from: date, to: date, staff: new Map(roster.map(row => [Number(row.id), row])),
        profiles: profileContext, rates: rateMap, schemes, assignments: roleMap,
        exceptions: new Map(exceptions.map(row => [exceptionKey(row.staffId, row.professionKey, row.workDate, row.purpose), row])) };
    const rows = [];
    for (const person of roster) {
        const staffId = Number(person.id);
        if (!Number.isSafeInteger(staffId) || staffId <= 0) continue;
        const primary = person.role_type ?? person.roleType;
        const keys = new Set([primary, ...(person.secondary_professions || [])].filter(Boolean));
        for (const key of roleMap.keys()) if (key.startsWith(staffId + ':')) keys.add(key.slice(key.indexOf(':') + 1));
        for (const assignment of assignments) if (Number(assignment.staffId ?? assignment.staff_id) === staffId
            && activeOnDate(assignment, date)) keys.add(assignment.professionKey ?? assignment.profession_key);
        for (const professionKey of keys) {
            const isPrimary = professionKey === primary;
            const findings = [], unverified = [];
            const role = roleMap.get(`${staffId}:${professionKey}`);
            if (!role) {
                if (rolesAvailable && !isPrimary) findings.push('assignment_missing');
                else unverified.push('assignment_unverified');
            } else {
                if (role.status !== 'active') findings.push('assignment_inactive');
                if (role.admission_status !== 'approved') findings.push('admission_not_approved');
            }
            if (!exceptionsAvailable) unverified.push('day_exception_unverified');
            if (!schemesAvailable) unverified.push('payroll_scheme_unverified');
            let effectiveSource = null, effectiveUnit = null;
            if (!profilesAvailable || !assignmentsAvailable) unverified.push('payroll_profile_unverified');
            else {
                const resolution = resolvePayrollConditions(context, staffId, professionKey, date, isPrimary ? 'base_replacement' : 'additional');
                effectiveSource = resolution.rateSource;
                effectiveUnit = resolution.rateUnit;
                const candidates = (profileContext.assignmentsByStaffProfession.get(`${staffId}:${professionKey}`) || [])
                    .filter(row => activeOnDate(row, date)).map(row => row.profile);
                const defaultProfile = profileContext.defaultProfilesByProfession.get(professionKey);
                if (defaultProfile) candidates.push(defaultProfile);
                if (!resolution.exception && candidates.some(profile => !profile || profile.status !== 'active'
                    || !profile.versions.some(version => activeOnDate(version, date)))) findings.push('payroll_profile_invalid');
                if (!['hour', 'day', 'month'].includes(effectiveUnit)) findings.push('rate_unit_conflict');
                if (!(resolution.rate > 0)) {
                    // Missing higher-priority sources cannot prove an effective rate is absent.
                    if (payrollAmountsAvailable && legacyRatesAvailable && schemesAvailable && exceptionsAvailable) findings.push('effective_rate_missing');
                    else unverified.push('effective_rate_unverified');
                }
                if (!resolution.applies && !legacyRatesAvailable) unverified.push('legacy_rate_unverified');
                if (effectiveUnit === 'month') {
                    const norm = resolution.monthlyNorm;
                    if (!schemesAvailable) unverified.push('monthly_norm_unverified');
                    else if (!norm.monthlyNormConfirmed || !norm.monthlyNormSource || !(norm.monthlyNormMinutes > 0)
                        || norm.monthlyNormMonth !== date.slice(0, 7)) findings.push('monthly_norm_unconfirmed');
                }
                const inherited = resolution.exception && resolvePayrollConditions(context, staffId, professionKey, date,
                    isPrimary ? 'base_replacement' : 'additional', { ignoreException: true });
                if (inherited && isPrimary && inherited.rateUnit !== resolution.rateUnit) findings.push('rate_unit_conflict');
            }
            rows.push({ staffId, professionKey, use: isPrimary ? 'primary' : 'potential_additional',
                findings: [...new Set(findings)], unverified: [...new Set(unverified)], effectiveSource, effectiveUnit });
        }
    }
    const counts = {};
    for (const row of rows) for (const finding of row.findings) counts[finding] = (counts[finding] || 0) + 1;
    return { schemaVersion: 2, readOnly: true, source, date,
        status: catalogPartial || !profilesAvailable || !assignmentsAvailable || !exceptionsAvailable || !schemesAvailable || sourceErrors.length || rows.some(row => row.unverified.length) ? 'PARTIAL' : 'DATA_AUDIT_COMPLETE',
        purpose: 'Configuration audit using the candidate resolver; not release or historical payroll proof', liveProof,
        coverage: { staff: roster.length, staffProfessionPairs: rows.length, catalogPartial, payrollAmountsAvailable,
            profilesAvailable, assignmentsAvailable, legacyRatesAvailable, rolesAvailable, exceptionsAvailable, schemesAvailable },
        counts, sourceErrors, rows,
        exclusions: ['no_historical_rate_reconstruction', 'no_closed_payroll_recalculation', 'no_salary_generation', 'no_payment_mutation'],
        interpretation: 'Potential additional roles are configuration checks, not mandatory paid roles. No names, salaries, free-text reasons or authors are saved.' };
}

module.exports = { activeOnDate, validateDate, buildProfileContext, buildHrPayReadiness };
