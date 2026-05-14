const PINATA_MODES = new Set(['none', 'park', 'client']);
const CLIENT_PINATA_FILLERS = new Set([
    'client',
    'own',
    'own pinata',
    'customer',
    'customer pinata',
    'клієнт',
    'клієнта',
    'клієнтська',
    'своя',
    'власна'
]);

function cleanString(value, maxLength = 500) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    if (!text) return null;
    return text.slice(0, maxLength);
}

function normalizeMode(value) {
    const mode = cleanString(value, 20)?.toLowerCase();
    return PINATA_MODES.has(mode) ? mode : null;
}

function isClientPinataFiller(value) {
    const normalized = cleanString(value, 80)?.toLowerCase();
    return !!normalized && CLIENT_PINATA_FILLERS.has(normalized);
}

function normalizeServicePrice(value) {
    if (value === undefined || value === null || value === '') return { value: null };
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) {
        return { error: 'clientPinataServicePrice must be a non-negative number' };
    }
    return { value: Math.round(amount * 100) / 100 };
}

function inferPinataMode(payload = {}, filler) {
    const explicit = normalizeMode(payload.pinataMode ?? payload.pinata_mode);
    if (explicit) return explicit;

    if (isClientPinataFiller(filler)) return 'client';

    const programId = cleanString(payload.programId ?? payload.program_id, 120);
    const category = cleanString(payload.category, 80);
    if (programId === 'pinata_own') return 'client';
    if (category === 'pinata' || programId === 'pinata' || programId === 'pinata_custom') return 'park';
    if (filler) return 'park';
    return 'none';
}

function normalizePinataFields(payload = {}) {
    const rawFiller = cleanString(payload.pinataFiller ?? payload.pinata_filler, 80);
    const pinataNumber = cleanString(payload.pinataNumber ?? payload.pinata_number, 80);
    const pinataFillerNumber = cleanString(payload.pinataFillerNumber ?? payload.pinata_filler_number, 80);
    const mode = inferPinataMode(payload, rawFiller);
    const priceResult = normalizeServicePrice(payload.clientPinataServicePrice ?? payload.client_pinata_service_price);
    if (priceResult.error) return { error: priceResult.error };

    if (mode === 'client') {
        return {
            pinataMode: 'client',
            pinataNumber,
            pinataFillerNumber,
            pinataFiller: null,
            clientPinataServicePrice: priceResult.value,
            clientPinataServiceNote: cleanString(payload.clientPinataServiceNote ?? payload.client_pinata_service_note, 1000)
        };
    }

    if (mode === 'park') {
        return {
            pinataMode: 'park',
            pinataNumber,
            pinataFillerNumber,
            pinataFiller: isClientPinataFiller(rawFiller) ? null : rawFiller,
            clientPinataServicePrice: null,
            clientPinataServiceNote: null
        };
    }

    return {
        pinataMode: 'none',
        pinataNumber: null,
        pinataFillerNumber: null,
        pinataFiller: null,
        clientPinataServicePrice: null,
        clientPinataServiceNote: null
    };
}

function buildPinataServices(pinataFields) {
    if (!pinataFields || pinataFields.pinataMode !== 'client') return [];
    return [{
        type: 'client_pinata_service',
        label: 'Клієнтська піньята',
        price: pinataFields.clientPinataServicePrice ?? 0,
        note: pinataFields.clientPinataServiceNote || null
    }];
}

module.exports = {
    normalizePinataFields,
    buildPinataServices,
    isClientPinataFiller
};
