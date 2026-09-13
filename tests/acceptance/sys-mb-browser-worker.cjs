'use strict';

const fs = require('node:fs');
const net = require('node:net');
const assert = require('node:assert/strict');
async function main() {
    // Synthetic passwords/session tokens travel through an anonymous pipe, never
    // a command argument, fixture file, screenshot or acceptance result artifact.
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    const options = JSON.parse(input);
    const records = [];
    const record = item => {
        records.push(item);
        fs.writeSync(1, 'D06_BROWSER_PROGRESS ' + item.id + ' ' + item.status + '\n');
    };
    let bridge;
    const sockets = new Set();
    try {
        // Windows and WSL do not share loopback on every host. Forward TCP bytes
        // only to the exact disposable application's local interface and port.
        const target = options.localForwardTarget;
        assert.match(target?.host || '', /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/);
        assert.ok(Number.isInteger(target.port) && target.port > 1024 && target.port <= 65535);
        bridge = net.createServer(socket => {
            sockets.add(socket);
            const upstream = net.connect(target.port, target.host);
            sockets.add(upstream);
            for (const connection of [socket, upstream]) {
                connection.on('close', () => sockets.delete(connection));
                connection.on('error', () => { socket.destroy(); upstream.destroy(); });
            }
            socket.pipe(upstream); upstream.pipe(socket);
        });
        await new Promise((resolve, reject) => { bridge.once('error', reject); bridge.listen(0, '127.0.0.1', resolve); });
        options.baseUrl = 'http://127.0.0.1:' + bridge.address().port;
        const health = await fetch(options.baseUrl + '/api/health', { signal: AbortSignal.timeout(10000) });
        assert.ok(health.ok, 'The TCP bridge must reach the actual application before browser scenarios');
        const { runBrowserAcceptance } = require('./sys-mb-browser-scenarios.cjs');
        const summary = await runBrowserAcceptance({ ...options, record });
        fs.writeSync(1, '\nD06_BROWSER_RESULT=' + JSON.stringify({ records, summary }) + '\n');
    } catch (error) {
        fs.writeSync(1, '\nD06_BROWSER_RESULT=' + JSON.stringify({ records,
            error: { name: error.name, message: String(error.message).slice(0, 800) } }) + '\n');
        process.exitCode = 1;
    } finally {
        for (const socket of sockets) socket.destroy();
        if (bridge) await new Promise(resolve => bridge.close(resolve));
    }
}
main().catch(() => { process.stderr.write('D06 browser worker failed before reporting\n'); process.exitCode = 1; });
