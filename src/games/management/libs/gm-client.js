/* global kiwi:true */
import { getConfig } from './config.js';
import { GM_TAG } from './constants.js';
import { decodeJsonBase64Url, encodeJsonBase64Url } from './base64url.js';
import { channelNamesMatch, nicksMatch } from './network.js';
import { t } from '../../shared/locales.js';
import { ensureGameMasterOnline, markGameMasterOnline, markGameMasterOffline } from './bot-presence.js';

const PUSH_OPS = new Set([
    'lobby.ready',
    'lobby.open',
    'lobby.kicked',
    'lobby.launched',
    'lobby.update',
    'queue.update',
    'start',
]);

function newRequestId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `gm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function sendTagmsg(ircClient, target, tags) {
    try {
        if (typeof ircClient.tagmsg === 'function') {
            ircClient.tagmsg(target, tags);
            return true;
        }
        if (typeof ircClient.Message === 'function' && typeof ircClient.raw === 'function') {
            const message = new ircClient.Message('TAGMSG', target);
            Object.assign(message.tags, tags);
            ircClient.raw(message);
            return true;
        }
    } catch (err) {
        console.warn('[gm-client] TAGMSG send failed', err);
        return false;
    }
    return false;
}

function resolveNetwork(preferred) {
    if (preferred && preferred.ircClient) return preferred;
    const active = kiwi.state.getActiveNetwork && kiwi.state.getActiveNetwork();
    if (active && active.ircClient) return active;
    const networks = kiwi.state.networks;
    if (!Array.isArray(networks)) return null;
    return networks.find((n) => n.ircClient) || null;
}

function eventTarget(event) {
    return event.target
        || (Array.isArray(event.params) && event.params[0])
        || '';
}

export class GmClient {
    constructor() {
        this.pending = new Map();
        this.bound = false;
        this.pushHandler = null;
    }

    /** Unsolicited bot TAGMSG (queue.update / lobby.* / start). */
    setPushHandler(handler) {
        this.pushHandler = typeof handler === 'function' ? handler : null;
    }

    bind() {
        if (this.bound) return;
        this.bound = true;
        kiwi.on('irc.tagmsg', (event, network) => {
            this.onTagmsg(event, network);
        });
        kiwi.on('irc.no such nick', (event, network) => {
            this.onMissingNick(event, network);
        });
        kiwi.on('irc.401', (event, network) => {
            this.onMissingNick(event, network);
        });
    }

    request(op, fields = {}, network) {
        const net = resolveNetwork(network);
        const irc = net && net.ircClient;
        if (!irc) {
            return Promise.reject(new Error(t('mgmt_err_no_network')));
        }

        const botNick = getConfig().gameMasterNick;

        return ensureGameMasterOnline(net, botNick).then((online) => {
            if (!online) {
                return Promise.reject(new Error(t('mgmt_err_offline', { nick: botNick })));
            }

            const id = newRequestId();
            const payload = { id, op, ...fields };
            const encoded = encodeJsonBase64Url(payload);

            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    this.pending.delete(id);
                    reject(new Error(t('mgmt_err_timeout', { op, nick: botNick })));
                }, getConfig().requestTimeoutMs);

                this.pending.set(id, {
                    resolve,
                    reject,
                    timer,
                    chunks: new Map(),
                    partsExpected: null,
                });

                const ok = sendTagmsg(irc, botNick, { [GM_TAG]: encoded });
                if (!ok) {
                    clearTimeout(timer);
                    this.pending.delete(id);
                    reject(new Error(t('mgmt_err_tagmsg')));
                }
            });
        });
    }

    onMissingNick(event, network) {
        const missing = event && (event.nick
            || event.nick_change
            || (Array.isArray(event.params) && event.params[1]));
        const botNick = getConfig().gameMasterNick;
        const irc = network && network.ircClient;
        if (nicksMatch(missing, botNick, irc)) {
            markGameMasterOffline(network, botNick);
        }
    }

    onTagmsg(event, network) {
        if (!event || !event.tags) return;
        const raw = event.tags[GM_TAG] || event.tags['+GM'];
        if (!raw || typeof raw !== 'string') return;

        const decoded = decodeJsonBase64Url(raw);
        if (!decoded || typeof decoded !== 'object') return;

        const irc = network && network.ircClient;
        const target = eventTarget(event);
        const salon = getConfig().salon;

        // Channel +gm is ignored: patches arrive privately. A salon TAGMSG
        // would otherwise make every plugin client refresh.
        if (channelNamesMatch(target, salon, irc && irc.caseCompare)) {
            return;
        }

        const botNick = getConfig().gameMasterNick;
        if (!nicksMatch(event.nick, botNick, irc)) return;
        markGameMasterOnline(network, botNick);

        const id = decoded.id == null ? '' : String(decoded.id);
        const pending = id ? this.pending.get(id) : null;

        if (!pending) {
            if (PUSH_OPS.has(decoded.op) && this.pushHandler) {
                this.pushHandler(decoded, network);
            }
            return;
        }

        if (
            typeof decoded.part === 'number'
            && typeof decoded.parts === 'number'
            && typeof decoded.chunk === 'string'
        ) {
            pending.partsExpected = decoded.parts;
            pending.chunks.set(decoded.part, decoded.chunk);

            if (pending.chunks.size < decoded.parts) return;

            const ordered = [];
            for (let i = 1; i <= decoded.parts; i += 1) {
                const piece = pending.chunks.get(i);
                if (piece == null) return;
                ordered.push(piece);
            }

            const finalPayload = decodeJsonBase64Url(ordered.join(''));
            if (!finalPayload) {
                this.finishError(id, new Error(t('mgmt_err_chunk')));
                return;
            }
            this.finishOk(id, finalPayload);
            return;
        }

        this.finishOk(id, decoded);
    }

    finishOk(id, response) {
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.resolve(response);
    }

    finishError(id, error) {
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(error);
    }
}
