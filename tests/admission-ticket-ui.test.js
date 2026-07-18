'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('Center ticket tab uses exact senior-manager mutation gate and append-only API', () => {
    const html = read('center.html');
    const page = read('js/center-page.js');
    const api = read('js/api.js');
    const sidebar = read('js/components/sidebar.js');
    assert.match(html, /data-tab="tickets"/);
    assert.match(html, /id="ticketCatalogMatrix"/);
    assert.match(page, /hasMinRole\('senior_manager'\)/);
    assert.match(page, /apiCreateAdmissionTicketTariffRevision/);
    assert.match(page, /expectedRevision/);
    assert.match(page, /result\?\.status === 409/);
    assert.match(api, /\/center\/tickets\/\$\{encodeURIComponent/);
    assert.doesNotMatch(api, /apiCall\('(?:GET|POST)', `\/api\/center\/tickets/);
    assert.match(sidebar, /\/center\?tab=tickets/);
});

test('booking ticket controls expose only four manual quantities and server quote state', () => {
    const html = read('index.html');
    const tickets = read('js/booking-tickets.js');
    const booking = read('js/booking.js');
    for (const id of [
        'ticketBirthdayChildQuantity',
        'ticketUnder3ChildQuantity',
        'ticketDiscountedChildQuantity',
        'ticketAdultGameQuantity'
    ]) {
        assert.match(html, new RegExp(`id="${id}"[^>]*inputmode="numeric"`));
    }
    assert.match(html, /id="ticketRegularChildQuantity"/);
    assert.match(html, /id="ticketAdultCompanionQuantity"/);
    assert.doesNotMatch(html, /id="ticketRegularChildQuantity"[^>]*<input/);
    assert.match(tickets, /apiQuoteAdmissionTickets/);
    assert.match(tickets, /sequenceKey:/);
    assert.match(tickets, /TICKET_PRICE_CHANGED/);
    assert.match(tickets, /conversionConfirmed/);
    assert.match(booking, /window\.BookingTickets\?\.validationIssue/);
    assert.match(booking, /obj\.ticketQuantities = formData\.ticketQuantities/);
});

test('ticket rows flow through booking detail, banquet summary, and PDF contracts', () => {
    const renderer = read('js/booking-package-renderer.js');
    const summary = read('services/banquetSummary.js');
    const pdf = read('services/banquetSummaryPdf.js');
    assert.match(renderer, /renderBookingPackageTicketRows/);
    assert.match(renderer, /line\.audience === 'adult' \? 'дорослих' : 'дітей'/);
    assert.match(summary, /function buildTicketRows/);
    assert.match(summary, /\.\.\.ticketRows/);
    assert.match(pdf, /\['ticket', 'entry'\]\.includes\(row\.type\)/);
});
