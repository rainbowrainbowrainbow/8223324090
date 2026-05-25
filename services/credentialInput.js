'use strict';

const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;
const LOGIN_LABEL_RE = /(?:^|\n|\r|;|\t|\s)(?:\u043b\u043e\u0433\u0456\u043d|login|username|user)\s*[:=]\s*([^\n\r;]+)/i;
const PASSWORD_LABEL_RE = /(?:^|\n|\r|;|\t|\s)(?:\u043f\u0430\u0440\u043e\u043b\u044c|password|pass|pwd)\s*[:=]\s*([^\n\r;]+)/i;

function compactCredentialText(value) {
    return String(value ?? '')
        .normalize('NFKC')
        .replace(ZERO_WIDTH_RE, '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim();
}

function extractCredentialBlock(value) {
    const text = compactCredentialText(value);
    if (!text) return { username: '', password: '', hasCredentialBlock: false };
    const loginMatch = text.match(LOGIN_LABEL_RE);
    const passwordMatch = text.match(PASSWORD_LABEL_RE);
    return {
        username: loginMatch ? compactCredentialText(loginMatch[1]) : '',
        password: passwordMatch ? compactCredentialText(passwordMatch[1]) : '',
        hasCredentialBlock: Boolean(loginMatch || passwordMatch)
    };
}

function normalizeCredentialPassword(value) {
    const text = compactCredentialText(value);
    if (!text) return '';
    const extracted = extractCredentialBlock(text);
    return extracted.password || text;
}

function normalizeManualPassword(value) {
    return normalizeCredentialPassword(value);
}

function uniquePasswordCandidates(...values) {
    const seen = new Set();
    const candidates = [];
    values.forEach(value => {
        const raw = String(value ?? '');
        const normalized = normalizeCredentialPassword(raw);
        [raw, raw.trim(), normalized].forEach(candidate => {
            const clean = compactCredentialText(candidate);
            if (!clean || seen.has(clean)) return;
            seen.add(clean);
            candidates.push(clean);
        });
    });
    return candidates;
}

function normalizeLoginCredentialPayload(body = {}) {
    const rawUsername = compactCredentialText(body.username);
    const rawPassword = compactCredentialText(body.password);
    const usernameBlock = extractCredentialBlock(rawUsername);
    const passwordBlock = extractCredentialBlock(rawPassword);
    const joinedBlock = extractCredentialBlock(`${rawUsername}\n${rawPassword}`);
    const username = usernameBlock.username || passwordBlock.username || joinedBlock.username || rawUsername;
    const password = passwordBlock.password || usernameBlock.password || joinedBlock.password || rawPassword;

    return {
        username: compactCredentialText(username),
        password: normalizeCredentialPassword(password),
        passwordCandidates: uniquePasswordCandidates(password, rawPassword, usernameBlock.password, passwordBlock.password, joinedBlock.password),
        parsedCredentialBlock: Boolean(usernameBlock.hasCredentialBlock || passwordBlock.hasCredentialBlock || joinedBlock.hasCredentialBlock)
    };
}

module.exports = {
    compactCredentialText,
    extractCredentialBlock,
    normalizeCredentialPassword,
    normalizeManualPassword,
    normalizeLoginCredentialPayload,
    uniquePasswordCandidates
};
