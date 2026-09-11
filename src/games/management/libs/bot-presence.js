/* global kiwi:true */
import { getConfig } from './config.js';
import { nicksMatch } from './network.js';

const ISON_TIMEOUT_MS = 4000;
const CACHE_ONLINE_MS = 20000;
const CACHE_OFFLINE_MS = 10000;

const cache = new Map();
const inflight = new Map();

function cacheKey(network, botNick) {
    const netId = network && network.id != null ? String(network.id) : '';
    return netId + '|' + String(botNick || '').toLowerCase();
}

function readCache(key) {
    const row = cache.get(key);
    if (!row) return null;
    if (Date.now() > row.until) {
        cache.delete(key);
        return null;
    }
    return row.online;
}

function writeCache(key, online, ttl) {
    cache.set(key, { online: Boolean(online), until: Date.now() + ttl });
}

export function markGameMasterOnline(network, botNick) {
    if (!botNick) return;
    writeCache(cacheKey(network, botNick), true, CACHE_ONLINE_MS);
}

export function markGameMasterOffline(network, botNick) {
    if (!botNick) return;
    writeCache(cacheKey(network, botNick), false, CACHE_OFFLINE_MS);
}

function salonUsers(network, salon) {
    if (!network || !salon) return [];
    const getBuffer = kiwi.state && kiwi.state.getBufferByName;
    const buffer = typeof getBuffer === 'function'
        ? getBuffer.call(kiwi.state, network.id, salon)
        : null;
    if (!buffer) return [];
    let rawUsers = null;
    if (Array.isArray(buffer.users)) rawUsers = buffer.users;
    else if (buffer.users && typeof buffer.users === 'object') rawUsers = Object.values(buffer.users);
    else if (typeof buffer.getUsers === 'function') rawUsers = buffer.getUsers();
    if (!Array.isArray(rawUsers)) return [];
    return rawUsers.map((u) => {
        if (!u) return '';
        if (typeof u === 'string') return u;
        if (typeof u.nick === 'string') return u.nick;
        return '';
    }).filter(Boolean);
}

function botInSalon(network, botNick) {
    const salon = getConfig().salon;
    const irc = network && network.ircClient;
    return salonUsers(network, salon).some((nick) => nicksMatch(nick, botNick, irc));
}

function nicksFromIsonEvent(event) {
    if (!event) return [];
    if (Array.isArray(event.nicks)) return event.nicks.filter(Boolean);
    const params = event.params || (event.event && event.event.params);
    if (Array.isArray(params) && params.length) {
        const last = params[params.length - 1];
        if (typeof last === 'string') {
            return last.trim() ? last.trim().split(/\s+/) : [];
        }
    }
    return [];
}

function sendIson(irc, botNick) {
    if (typeof irc.raw === 'function') {
        irc.raw('ISON', botNick);
        return;
    }
    if (typeof irc.write === 'function') {
        irc.write('ISON ' + botNick);
    }
}

const isonWaiters = new Set();
let isonListenersBound = false;

function detachWaiter(waiter) {
    isonWaiters.delete(waiter);
    if (waiter.timer) clearTimeout(waiter.timer);
}

function onIsonReply(event, network) {
    const nicks = nicksFromIsonEvent(event);
    isonWaiters.forEach((waiter) => {
        if (network && waiter.network && network.id !== waiter.network.id) return;
        const irc = waiter.network && waiter.network.ircClient;
        if (nicks.some((nick) => nicksMatch(nick, waiter.botNick, irc))) {
            waiter.resolve(true);
            detachWaiter(waiter);
            return;
        }
        if (nicks.length === 0) {
            waiter.resolve(false);
            detachWaiter(waiter);
        }
    });
}

function bindIsonListeners(network) {
    if (!isonListenersBound && kiwi && typeof kiwi.on === 'function') {
        isonListenersBound = true;
        kiwi.on('irc.ison', onIsonReply);
        kiwi.on('irc.303', onIsonReply);
    }
    const irc = network && network.ircClient;
    if (irc && !irc._kiwiGmIsonBound && typeof irc.on === 'function') {
        irc._kiwiGmIsonBound = true;
        irc.on('ison', (event) => onIsonReply(event, network));
        irc.on('303', (event) => onIsonReply(event, network));
    }
}

function probeIson(network, botNick) {
    const irc = network && network.ircClient;
    if (!irc) return Promise.resolve(false);

    bindIsonListeners(network);

    return new Promise((resolve) => {
        const waiter = {
            network,
            botNick,
            resolve: (online) => {
                waiter.resolve = () => {};
                resolve(Boolean(online));
            },
            timer: null,
        };
        waiter.timer = setTimeout(() => {
            waiter.resolve(false);
            detachWaiter(waiter);
        }, ISON_TIMEOUT_MS);
        isonWaiters.add(waiter);
        sendIson(irc, botNick);
    });
}

/**
 * True if gameMaster is online. Uses the salon nicklist when possible,
 * otherwise ISON. Results are cached so we do not ISON on every click.
 */
export function ensureGameMasterOnline(network, botNick) {
    const nick = typeof botNick === 'string' ? botNick.trim() : '';
    if (!network || !nick) return Promise.resolve(false);

    const key = cacheKey(network, nick);
    const cached = readCache(key);
    if (cached != null) return Promise.resolve(cached);

    if (botInSalon(network, nick)) {
        writeCache(key, true, CACHE_ONLINE_MS);
        return Promise.resolve(true);
    }

    const pending = inflight.get(key);
    if (pending) return pending;

    const probe = probeIson(network, nick).then((online) => {
        writeCache(key, online, online ? CACHE_ONLINE_MS : CACHE_OFFLINE_MS);
        inflight.delete(key);
        return online;
    }).catch(() => {
        writeCache(key, false, CACHE_OFFLINE_MS);
        inflight.delete(key);
        return false;
    });

    inflight.set(key, probe);
    return probe;
}
