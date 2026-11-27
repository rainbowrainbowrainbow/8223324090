'use strict';

function validateGoogleChatWebhook(value) {
    const url = URL.parse(typeof value === 'string' && value.length <= 2048 ? value : '');
    const space = /^\/v1\/spaces\/([A-Za-z0-9_-]+)\/messages$/.exec(url?.pathname);
    const keys = url ? [...url.searchParams.keys()] : [];
    if (!url || url.origin !== 'https://chat.googleapis.com' || url.username || url.password || url.hash
        || !space || keys.length !== 2 || !url.searchParams.get('key') || !url.searchParams.get('token')) {
        throw Object.assign(new Error('Вкажіть вхідний вебхук простору Google Chat'), { statusCode: 400 });
    }
    return { url: url.href, destinationKey: 'google_chat:' + space[1] };
}

async function deliverGoogleChatAnnouncement(recipient, text, request = fetch) {
    let url;
    try {
        ({ url } = validateGoogleChatWebhook(recipient.webhook));
    } catch {
        return { status: 'failed', code: 'google_chat_configuration' };
    }
    try {
        const response = await request(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
            redirect: 'error',
            signal: AbortSignal.timeout(12_000)
        });
        if (response.ok) {
            const body = await response.json().catch(() => null);
            return { status: 'sent', messageId: body?.name ?? null };
        }
        await response.body?.cancel().catch(() => {});
        if (response.status === 429) {
            const seconds = Number(response.headers.get('retry-after'));
            return { status: 'retry', code: 'rate_limited', retryAfterSeconds: Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null };
        }
        if (response.status >= 400 && response.status < 500 && response.status !== 408) {
            return { status: 'failed', code: 'google_chat_rejected' };
        }
    } catch {
        // Do not log provider exceptions that could include a webhook URL.
    }
    return { status: 'uncertain', code: 'google_chat_unconfirmed' };
}

module.exports = { validateGoogleChatWebhook, deliverGoogleChatAnnouncement };
