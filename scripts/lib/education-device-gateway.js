'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const APP_PORT = 3013;
const LAN_PORT = 3014;
function privateAddress(value) {
    if (net.isIP(value) !== 4) return false;
    const [a,b] = value.split('.').map(Number);
    return a === 10 || a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31;
}
function sameSubnet(remote, host, prefix) {
    if (net.isIP(remote) !== 4 || net.isIP(host) !== 4 || !Number.isInteger(prefix) || prefix < 16 || prefix > 30) return false;
    const number = value => value.split('.').reduce((sum,part)=>(sum*256+Number(part))>>>0,0);
    const mask = (0xffffffff << (32-prefix)) >>> 0;
    return (number(remote)&mask) === (number(host)&mask);
}
function allowedWrite(method, pathname) {
    pathname = pathname.replace(/\/+$/, '') || '/';
    if (['GET','HEAD','OPTIONS'].includes(method)) return true;
    if (/^\/api\/auth\/(login|refresh|logout)$/.test(pathname)) return method === 'POST';
    if (/^\/api\/education\/(groups|attendance)(\/[^/]+)*$/.test(pathname)) return ['POST','PUT','PATCH','DELETE'].includes(method);
    if (pathname === '/api/bookings') return method === 'POST';
    if (pathname === '/api/bookings/education-series') return method === 'POST';
    if (/^\/api\/bookings\/education-series\/[^/]+\/cancel$/.test(pathname)) return method === 'POST';
    if (/^\/api\/bookings\/[^/]+$/.test(pathname)) return ['PUT','DELETE'].includes(method);
    if (/^\/api\/bookings\/[^/]+\/(confirm|preliminary)$/.test(pathname)) return method === 'POST';
    if (pathname === '/api/history') return method === 'POST';
    if (['/api/business/cabinet','/api/settings/timeline-display','/api/settings/timeline-visibility'].includes(pathname)) return method === 'PUT';
    if (/^\/api\/timeline\/resources(\/[^/]+)?$/.test(pathname)) return ['POST','PUT','PATCH','DELETE'].includes(method);
    return false;
}
function createGateway({ host, prefix = 24, stats = {}, appPort = APP_PORT, lanPort = LAN_PORT, writePolicy = allowedWrite }) {
    assert.ok(privateAddress(host), 'An explicit RFC1918 IPv4 interface is required');
    assert.ok(Number.isInteger(prefix) && prefix >= 16 && prefix <= 30);
    assert.ok([appPort, lanPort].every(port => Number.isInteger(port) && port > 1024 && port < 65536));
    const origin = `http://${host}:${lanPort}`;
    const reject = (res, status, message) => { stats.blocked = (stats.blocked || 0) + 1;res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:message})); };
    const server = http.createServer((req,res)=>{
        if (!sameSubnet(req.socket.remoteAddress,host,prefix) || req.headers.host !== `${host}:${lanPort}`)
            return reject(res,403,'Owned local device preview only');
        if (req.headers.origin && req.headers.origin !== origin) return reject(res,403,'Unexpected request origin');
        if (!req.url?.startsWith('/') || req.url.startsWith('//')) return reject(res,400,'Relative paths only');
        let pathname;try { pathname = decodeURIComponent(new URL(req.url,origin).pathname); } catch { return reject(res,400,'Invalid path'); }
        if (!writePolicy(req.method,pathname)) return reject(res,403,'Outside education device QA scope');
        const headers = {...req.headers,host:`127.0.0.1:${appPort}`};
        for (const key of ['forwarded','x-forwarded-host','x-forwarded-for','x-forwarded-proto']) delete headers[key];
        // This is always the separately owned loopback app; no caller-supplied target.
        const upstream = http.request({host:'127.0.0.1',port:appPort,path:req.url,method:req.method,headers},response=>{
            const outgoing = {...response.headers,'cache-control':'no-store'};
            res.writeHead(response.statusCode,outgoing);response.pipe(res);
        });
        upstream.setTimeout(60000,()=>upstream.destroy());
        upstream.on('error',()=>{if (!res.headersSent) reject(res,502,'Owned device app unavailable');else res.destroy();});
        req.on('aborted',()=>upstream.destroy());req.pipe(upstream);
    });
    // The existing local outbound/WebSocket hold remains an explicit preview limit.
    server.on('upgrade',(_req,socket)=>socket.destroy());
    server.headersTimeout = 15000;server.requestTimeout = 60000;
    return server;
}
module.exports = { APP_PORT, LAN_PORT, privateAddress, sameSubnet, allowedWrite, createGateway };
