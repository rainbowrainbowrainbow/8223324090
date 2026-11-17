'use strict';

const c = require('./staffSubstitutionContract');
const {
    acquirePayrollPeriodMutationLock,
    loadPayrollPeriodLock,
    lockPayrollPeriodMutation
} = require('./hrPayrollPeriod');

const PARK = 'event_genix';
const CORRECTION_COLUMNS = `id, substitution_id, staff_id, payee, work_date::text AS work_date,
    posting_month, before_minor, after_minor, delta_minor, reason, actor, created_at`;

function mapCorrection(row) {
    return {
        id: String(row.id),
        substitutionId: String(row.substitution_id),
        staffId: Number(row.staff_id),
        payee: row.payee,
        workDate: row.work_date,
        postingMonth: row.posting_month,
        beforeMinor: Number(row.before_minor),
        afterMinor: Number(row.after_minor),
        deltaMinor: Number(row.delta_minor),
        reason: row.reason,
        actor: row.actor,
        createdAt: row.created_at
    };
}

async function loadCorrectionHistory(db, substitutionId) {
    const result = await db.query(`SELECT ${CORRECTION_COLUMNS} FROM staff_substitution_pay_corrections
        WHERE substitution_id=$1 ORDER BY id`, [substitutionId]);
    return result.rows.map(mapCorrection);
}

async function loadPayrollCorrections(db, month, staffId = null) {
    const result = await db.query(`SELECT ${CORRECTION_COLUMNS} FROM staff_substitution_pay_corrections
        WHERE posting_month=$1 AND ($2::int IS NULL OR staff_id=$2) ORDER BY id`, [month, staffId]);
    const byStaff = new Map();
    const corrections = result.rows.map(mapCorrection);
    const { loadWorkCorrectionLines } = require('./staffSubstitutionWorkCorrections');
    corrections.push(...await loadWorkCorrectionLines(db, month, staffId));
    for (const correction of corrections) {
        const { id, staffId: payeeId, substitutionId, deltaMinor } = correction;
        if (!byStaff.has(payeeId)) byStaff.set(payeeId, []);
        byStaff.get(payeeId).push({
            group: 'manual', lineType: 'staff_substitution_correction',
            label: correction.label || `Коригування підміни #${substitutionId} · #${id}`,
            amount: deltaMinor / 100, quantity: 1, source: 'staff_substitution_correction',
            meta: { ...correction, correctionId: id, businessContext: PARK }
        });
    }
    return byStaff;
}

async function loadFrozenFixedPay(db, row) {
    if (!row.completion_json?.originalFixedPay || row.state !== 'completed') return null;
    const month = row.input_json.workDate.slice(0, 7);
    const { rows } = await db.query(`SELECT breakdown_json->'lines' AS lines FROM payroll_reports
        WHERE staff_id=$1 AND period_month=$2 AND status IN ('reviewed','approved','paid') AND voided_at IS NULL`,
    [row.original_staff_id, month]);
    const lines = rows[0]?.lines;
    if (!Array.isArray(lines)) return null;
    const matches = lines.filter(line => line.lineType === 'staff_substitution' && line.meta?.payee === 'original'
        && line.meta?.substitutionId === String(row.id) && line.meta.fixedRetention);
    if (matches.length !== 1) return null;
    const settled = matches[0].meta.fixedRetention;
    if (!Number.isSafeInteger(settled.amountMinor) || settled.amountMinor < 0
        || matches[0].amount !== settled.amountMinor / 100) return null;
    return settled;
}

function allowedPayees(row, frozenFixedPay = null) {
    const replacement = row.completion_json?.amountMinor;
    const original = row.completion_json?.originalPay?.amountMinor ?? frozenFixedPay?.amountMinor;
    const payees = [];
    if (row.state !== 'completed') return payees;
    if (row.staff_id && Number.isSafeInteger(replacement) && replacement >= 0) {
        payees.push({ role: 'replacement', staffId: row.staff_id, amountMinor: replacement, maximumDebitMinor: 0 });
    }
    if (row.original_staff_id && Number.isSafeInteger(original)) {
        const reference = row.quote_json?.payImpact?.originalReference;
        const maximumDebitMinor = ['day', 'month'].includes(reference?.rateUnit)
            && Number.isSafeInteger(reference.rateMinor) ? Math.max(0, reference.rateMinor) : 0;
        payees.push({ role: 'original', staffId: row.original_staff_id, amountMinor: original, maximumDebitMinor });
    }
    return payees;
}

async function latestCorrection(db, substitutionId, payee) {
    const result = await db.query(`SELECT id, after_minor, posting_month FROM staff_substitution_pay_corrections
        WHERE substitution_id=$1 AND payee=$2 ORDER BY id DESC LIMIT 1`, [substitutionId, payee]);
    return result.rows[0] || null;
}

function assertCurrentCorrection(latest, expectedId) {
    if ((latest ? String(latest.id) : null) !== expectedId) {
        c.fail('SUBSTITUTION_CORRECTION_STALE', 'Суму вже змінено. Відкрийте історію та перевірте актуальне коригування.', 409);
    }
}

async function isPostingFrozen(db, month, staffId) {
    if ((await loadPayrollPeriodLock(month, db)).is_locked) return true;
    const result = await db.query(`SELECT EXISTS (
        SELECT 1 FROM payroll_reports pr WHERE pr.period_month=$1 AND pr.staff_id=$2
            AND (pr.status <> 'draft' OR pr.voided_at IS NOT NULL OR pr.finance_transaction_id IS NOT NULL
                 OR pr.reversal_transaction_id IS NOT NULL OR EXISTS (
                     SELECT 1 FROM payroll_installments pi WHERE pi.payroll_report_id=pr.id
                         AND (pi.workflow_status <> 'draft' OR EXISTS (
                             SELECT 1 FROM payroll_payment_movements ppm WHERE ppm.installment_id=pi.id
                         ))
                 ))
    ) AS frozen`, [month, staffId]);
    return result.rows[0].frozen;
}

function normalizeCorrection(payload) {
    const payee = c.choice(payload.payee, ['replacement', 'original'], 'працівника');
    const postingMonth = c.text(payload.postingMonth, 'місяць нарахування', 7);
    if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(postingMonth)) {
        c.fail('SUBSTITUTION_CORRECTION_MONTH_INVALID', 'Введіть місяць у форматі РРРР-ММ.');
    }
    const amount = String(payload.correctedAmount ?? '').trim().replace(',', '.');
    const isDebit = amount.startsWith('-');
    const amountMinor = c.decimalUnits(isDebit ? amount.slice(1) : amount, 2, 'виправлена сума', true);
    const expectedId = payload.expectedCorrectionId === null
        ? null : String(c.integer(payload.expectedCorrectionId, 'поточне коригування', 1, Number.MAX_SAFE_INTEGER));
    return { payee, postingMonth, afterMinor: isDebit ? -amountMinor : amountMinor, expectedId,
        reason: c.text(payload.reason, 'причина коригування') };
}

async function postCorrection(db, readSubstitution, business, actor, rawId, payload) {
    if (business !== PARK) c.fail('SUBSTITUTION_BUSINESS_UNSUPPORTED', 'Коригування завершених підмін доступні у Park.', 403);
    const id = c.integer(rawId, 'підміна', 1);
    const name = c.text(actor?.username, 'автор', 100);
    const key = c.text(payload.requestKey, 'ключ запиту', 128);
    const input = normalizeCorrection(payload);
    const { payee, postingMonth, afterMinor, expectedId, reason } = input;
    const hash = c.fingerprint({ id, ...input });
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`substitution-correction:${name}:${key}`]);
        const priorRequest = (await client.query(`SELECT ${CORRECTION_COLUMNS}, request_hash FROM staff_substitution_pay_corrections
            WHERE actor=$1 AND request_key=$2`, [name, key])).rows[0];
        if (priorRequest) {
            if (priorRequest.request_hash !== hash) c.fail('SUBSTITUTION_REQUEST_REUSED', 'Ключ уже використано для іншого запиту.', 409);
            await client.query('COMMIT');
            return mapCorrection(priorRequest);
        }

        const row = await readSubstitution(client, business, id);
        if (row.state !== 'completed') c.fail('SUBSTITUTION_CORRECTION_NOT_COMPLETED', 'Коригувати можна лише завершену підміну.', 409);
        const workDate = row.input_json.workDate;
        const previous = await latestCorrection(client, id, payee);
        assertCurrentCorrection(previous, expectedId);
        const currentMonth = previous?.posting_month || workDate.slice(0, 7);
        if (postingMonth < currentMonth) c.fail('SUBSTITUTION_CORRECTION_MONTH_INVALID', 'Оберіть місяць поточного нарахування або пізніший.');

        // Payroll locks precede the substitution lock. Posting cannot precede the current entry.
        const months = new Set([...(payee === 'original' && row.completion_json?.originalFixedPay ? [workDate.slice(0, 7)] : []),
            currentMonth, postingMonth]);
        for (const month of months) {
            await lockPayrollPeriodMutation(month, client);
            await acquirePayrollPeriodMutationLock(client, month);
        }
        const lockedRow = await readSubstitution(client, business, id, true);
        if (payee === 'replacement' && await require('./staffSubstitutionWorkCorrections').loadWorkCorrection(client, id)) {
            c.fail('SUBSTITUTION_CORRECTION_REALLOCATED', 'Нарахування виконавця вже перенесено коригуванням факту.', 409);
        }
        const fixed = payee === 'original' ? await loadFrozenFixedPay(client, lockedRow) : null;
        const agreementPayee = allowedPayees(lockedRow, fixed).find(item => item.role === payee);
        if (!agreementPayee) c.fail('SUBSTITUTION_CORRECTION_PAYEE_INVALID', 'За підміною немає зафіксованого нарахування для цього працівника.', 409);
        const { staffId, amountMinor, maximumDebitMinor } = agreementPayee;
        if (afterMinor < -maximumDebitMinor) c.fail('SUBSTITUTION_CORRECTION_AMOUNT_INVALID', 'Сума виходить за межі історично погодженої оплати.');
        const latest = await latestCorrection(client, id, payee);
        assertCurrentCorrection(latest, expectedId);
        if (postingMonth !== currentMonth && !await isPostingFrozen(client, currentMonth, staffId)) {
            c.fail('SUBSTITUTION_CORRECTION_MONTH_OPEN', `Коригування належить до відкритого місяця ${currentMonth}.`, 409);
        }
        if (await isPostingFrozen(client, postingMonth, staffId)) {
            c.fail('SUBSTITUTION_CORRECTION_PERIOD_FROZEN', `Розрахунок за ${postingMonth} закрито або вже затверджено. Оберіть пізніший відкритий місяць.`, 409);
        }
        const beforeMinor = latest ? Number(latest.after_minor) : amountMinor;
        if (beforeMinor === afterMinor) c.fail('SUBSTITUTION_CORRECTION_UNCHANGED', 'Вкажіть суму, відмінну від поточного нарахування.');
        if (!Number.isSafeInteger(afterMinor - beforeMinor)) c.fail('SUBSTITUTION_CORRECTION_AMOUNT_INVALID', 'Різниця перевищує допустиму суму.');
        const result = await client.query(`INSERT INTO staff_substitution_pay_corrections
            (substitution_id,staff_id,payee,work_date,posting_month,before_minor,after_minor,actor,reason,request_key,request_hash)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            RETURNING ${CORRECTION_COLUMNS}`, [id, staffId, payee, workDate, postingMonth, beforeMinor, afterMinor, name, reason, key, hash]);
        await client.query('COMMIT');
        return mapCorrection(result.rows[0]);
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { allowedPayees, isPostingFrozen, loadFrozenFixedPay, loadCorrectionHistory, loadPayrollCorrections, postCorrection };
