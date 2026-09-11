/* global kiwi:true */
import { GAME_IDS, GAME_LABELS } from './constants.js';
import { getConfig } from './config.js';
import { addChannelSystemMessage } from './network.js';
import { t } from '../../shared/locales.js';
import { isGameEnabled } from '../../shared/pluginConfig.js';

const REFRESH_COOLDOWN_MS = 8000;
const SCORES_COOLDOWN_MS = 8000;

function emptyGames() {
    return GAME_IDS.filter((id) => isGameEnabled(id)).map((id) => ({
        id,
        label: GAME_LABELS[id] || id,
        minPlayers: 2,
        maxPlayers: id === 'pictionary' ? 10 : 2,
        queueCount: 0,
        openLobbies: 0,
    }));
}

function createInitialState() {
    return {
        loading: false,
        error: '',
        games: emptyGames(),
        queues: {},
        lobbiesOpen: [],
        lobbiesReady: [],
        meQueues: [],
        meLobbies: [],
        meAccount: '',
        meNick: '',
        expandedGame: '',
        scoresOpenGame: '',
        scoresByGame: {},
        lastUpdated: 0,
        refreshLocked: false,
        queueInviteLocked: false,
    };
}

function normalizeScoreEntry(entry) {
    return {
        rank: Number(entry && entry.rank) || 0,
        account: String((entry && entry.account) || ''),
        wins: Number(entry && entry.wins) || 0,
        draws: Number(entry && entry.draws) || 0,
        losses: Number(entry && entry.losses) || 0,
        games: Number(entry && entry.games) || 0,
        ratio: Number(entry && entry.ratio) || 0,
    };
}

function emptyScoresState() {
    return {
        loading: false,
        error: '',
        label: '',
        top: [],
        me: null,
        fetchedAt: 0,
        locked: false,
    };
}

function asObject(data) {
    return data && typeof data === 'object' ? data : {};
}

function playerNick(p) {
    if (typeof p === 'string') return p.trim();
    return String((p && p.nick) || (p && p.account) || '').trim();
}

function normalizePlayer(p) {
    if (typeof p === 'string') {
        return { account: '', nick: p.trim(), joinedAt: '' };
    }
    return {
        account: String((p && p.account) || ''),
        nick: playerNick(p),
        joinedAt: String((p && p.joinedAt) || ''),
    };
}

function lobbyPlayerNicks(source) {
    if (!source) return [];
    if (Array.isArray(source.players)) {
        return source.players.map(playerNick).filter(Boolean);
    }
    if (Array.isArray(source.nicks)) {
        return source.nicks.map((n) => String(n || '').trim()).filter(Boolean);
    }
    return [];
}

function compactPlayerNicks(players) {
    if (!Array.isArray(players)) return null;
    const nicks = players
        .filter((p) => typeof p === 'string')
        .map((p) => p.trim())
        .filter(Boolean);
    return nicks;
}

function normalizeLobby(l) {
    return {
        id: String((l && l.id) || ''),
        game: String((l && l.game) || ''),
        label: String((l && l.label) || (l && l.game) || ''),
        maxPlayers: Number(l && l.maxPlayers) || 2,
        status: String((l && l.status) || ''),
        createdBy: String((l && l.createdBy) || ''),
        createdAt: String((l && l.createdAt) || ''),
        completedAt: l && l.completedAt == null ? null : String(l.completedAt),
        launchCommand: typeof (l && l.launchCommand) === 'string' ? l.launchCommand : '',
        players: Array.isArray(l && l.players) ? l.players.map(normalizePlayer) : [],
    };
}

function lobbyEventLabel(lobby, fallbackId) {
    return {
        id: String((lobby && lobby.id) || fallbackId || ''),
        game: String((lobby && (lobby.label || lobby.game)) || ''),
    };
}

function gameDisplayName(gameId) {
    const id = String(gameId || '');
    const translated = t('dropdown_' + id);
    if (translated && translated.indexOf('dropdown_') === -1) {
        return translated;
    }
    return GAME_LABELS[id] || id;
}

function postSalon(network, message) {
    addChannelSystemMessage(network, getConfig().salon, message);
}

export class GameStore {
    constructor(client) {
        const initial = createInitialState();
        this.state = kiwi.Vue && kiwi.Vue.observable
            ? kiwi.Vue.observable(initial)
            : initial;
        this.client = client;
        this.refreshSeq = 0;
        this._queueInviteUnlockTimer = null;
        this._refreshInFlight = null;
        this._refreshNetwork = null;
        this._unlockRefreshTimer = null;
        this._unlockScoresTimers = {};
    }

    setExpanded(gameId) {
        this.state.expandedGame = gameId || '';
    }

    scoresFor(gameId) {
        return this.state.scoresByGame[gameId] || emptyScoresState();
    }

    isScoresOpen(gameId) {
        return this.state.scoresOpenGame === gameId;
    }

    async toggleScores(gameId, network) {
        if (this.state.scoresOpenGame === gameId) {
            this.state.scoresOpenGame = '';
            return;
        }
        this.state.scoresOpenGame = gameId;
        await this.fetchScores(gameId, network);
    }

    lockScores(gameId) {
        const prev = this.scoresFor(gameId);
        this.state.scoresByGame = {
            ...this.state.scoresByGame,
            [gameId]: { ...prev, locked: true },
        };
        if (this._unlockScoresTimers[gameId]) {
            clearTimeout(this._unlockScoresTimers[gameId]);
        }
        this._unlockScoresTimers[gameId] = setTimeout(() => {
            const current = this.scoresFor(gameId);
            this.state.scoresByGame = {
                ...this.state.scoresByGame,
                [gameId]: { ...current, locked: false },
            };
            delete this._unlockScoresTimers[gameId];
        }, SCORES_COOLDOWN_MS);
    }

    async fetchScores(gameId, network) {
        if (!gameId) return;

        const prev = this.scoresFor(gameId);
        if (prev.loading || prev.locked) return;
        this.lockScores(gameId);
        this.state.scoresByGame = {
            ...this.state.scoresByGame,
            [gameId]: {
                ...this.scoresFor(gameId),
                loading: true,
                error: '',
            },
        };

        try {
            const res = await this.client.request('scores', { game: gameId }, network);
            if (!res.ok) {
                this.state.scoresByGame = {
                    ...this.state.scoresByGame,
                    [gameId]: {
                        ...this.scoresFor(gameId),
                        loading: false,
                        error: res.error || t('mgmt_err_scores'),
                    },
                };
                return;
            }

            const data = asObject(res.data);
            const topRaw = Array.isArray(data.top) ? data.top : [];
            const top = topRaw.slice(0, 5).map(normalizeScoreEntry);
            const me = data.me && typeof data.me === 'object'
                ? normalizeScoreEntry(data.me)
                : null;

            this.state.scoresByGame = {
                ...this.state.scoresByGame,
                [gameId]: {
                    loading: false,
                    error: '',
                    label: String(data.label || data.game || gameId),
                    top,
                    me,
                    fetchedAt: Date.now(),
                    locked: true,
                },
            };
        } catch (err) {
            this.state.scoresByGame = {
                ...this.state.scoresByGame,
                [gameId]: {
                    ...this.scoresFor(gameId),
                    loading: false,
                    error: err instanceof Error ? err.message : String(err),
                },
            };
        }
    }

    queueFor(gameId) {
        return this.state.queues[gameId] || [];
    }

    openLobbiesFor(gameId) {
        return this.state.lobbiesOpen.filter((l) => l.game === gameId);
    }

    readyLobbiesFor(gameId) {
        return this.state.lobbiesReady.filter((l) => l.game === gameId);
    }

    lobbiesFor(gameId) {
        return this.openLobbiesFor(gameId).concat(this.readyLobbiesFor(gameId));
    }

    isQueueInviteLocked() {
        return Boolean(this.state.queueInviteLocked);
    }

    lockQueueInvites(durationMs = 2 * 60 * 1000) {
        this.state.queueInviteLocked = true;
        if (this._queueInviteUnlockTimer) {
            clearTimeout(this._queueInviteUnlockTimer);
        }
        this._queueInviteUnlockTimer = setTimeout(() => {
            this.state.queueInviteLocked = false;
            this._queueInviteUnlockTimer = null;
        }, durationMs);
    }

    isInQueue(gameId) {
        return this.state.meQueues.includes(gameId);
    }

    isInLobby(lobbyId) {
        return this.state.meLobbies.includes(lobbyId);
    }

    handlePush(payload, network) {
        const op = payload && payload.op;
        const data = asObject(payload && payload.data);

        if (op === 'queue.update') {
            this.applyQueuePatch(data);
            const nick = data.nick && String(data.nick);
            if (data.action === 'joined' && nick) {
                postSalon(network, t('mgmt_queue_peer', {
                    nick,
                    game: gameDisplayName(data.game),
                }));
            }
            return;
        }

        if (op === 'lobby.update') {
            this.applyLobbyUpdate(data);
            return;
        }

        const lobby = asObject(data.lobby);
        const { id, game } = lobbyEventLabel(lobby, data.lobbyId);

        if (op === 'lobby.ready') {
            if (lobby.id) this.upsertLobby(lobby);
            postSalon(network, t('mgmt_push_ready', { id, game }));
            return;
        }
        if (op === 'lobby.open') {
            this.applyLobbyUpdate({
                id: data.id || data.lobbyId,
                game: data.game,
                status: data.status || 'open',
                players: data.players,
            });
            const { id, game } = lobbyEventLabel(
                { game: data.game },
                data.id || data.lobbyId,
            );
            postSalon(network, t('mgmt_push_open', { id, game: game || gameDisplayName(data.game) }));
            return;
        }
        if (op === 'lobby.kicked') {
            const kickedId = data.lobbyId || data.id;
            this.removeMeLobby(kickedId);
            this.removeLobby(kickedId, data.game);
            postSalon(network, t('mgmt_push_kicked', {
                id: kickedId,
                game: gameDisplayName(data.game),
            }));
            return;
        }
        if (op === 'lobby.launched') {
            const launchedId = data.lobbyId || data.id;
            const existing = this.findLobby(launchedId);
            const nicks = lobbyPlayerNicks(existing);
            this.removeLobby(launchedId, (existing && existing.game) || data.game);
            this.removeMeLobby(launchedId);
            this.removeNicksFromQueues(nicks);
            postSalon(network, t('mgmt_push_launched', {
                id: launchedId,
                game: (existing && existing.label) || gameDisplayName(data.game || (existing && existing.game)),
            }));
            return;
        }
        if (op === 'start') {
            const nicks = []
                .concat(data.removed || [])
                .concat(data.nicks || [])
                .filter(Boolean);
            (data.lobbies || []).forEach((lobbyId) => this.removeLobby(String(lobbyId)));
            this.removeNicksFromQueues(nicks);
            postSalon(network, t('mgmt_push_start'));
        }
    }

    lockRefresh() {
        this.state.refreshLocked = true;
        if (this._unlockRefreshTimer) clearTimeout(this._unlockRefreshTimer);
        this._unlockRefreshTimer = setTimeout(() => {
            this.state.refreshLocked = false;
            this._unlockRefreshTimer = null;
        }, REFRESH_COOLDOWN_MS);
    }

    refresh(network) {
        if (this._refreshInFlight) {
            return this._refreshInFlight;
        }
        if (this.state.refreshLocked) {
            return Promise.resolve();
        }

        this.lockRefresh();
        this._refreshNetwork = network || this._refreshNetwork;
        this.state.loading = true;
        this._refreshInFlight = this._refreshNow().finally(() => {
            this.state.loading = false;
            this._refreshInFlight = null;
        });
        return this._refreshInFlight;
    }

    async _refreshNow() {
        const network = this._refreshNetwork;
        const seq = ++this.refreshSeq;

        try {
            const stateRes = await this.client.request('state', {}, network);

            if (seq !== this.refreshSeq) return;

            if (!stateRes.ok) {
                this.state.error = stateRes.error || t('mgmt_err_load');
                return;
            }

            const data = asObject(stateRes.data);
            this.applyState(data);

            if (!data.me) {
                const meRes = await this.client.request('me', {}, network).catch(() => null);
                if (seq !== this.refreshSeq) return;
                if (meRes && meRes.ok) this.applyMe(asObject(meRes.data));
            }

            this.state.lastUpdated = Date.now();
            this.state.error = '';
        } catch (err) {
            if (seq !== this.refreshSeq) return;
            this.state.error = err instanceof Error ? err.message : String(err);
        }
    }

    queueJoin(game, network) {
        return this.mutate('queue.join', { game }, network);
    }

    queueLeave(game, network) {
        return this.mutate('queue.leave', { game }, network);
    }

    lobbyCreate(game, maxPlayers, network) {
        const fields = { game };
        if (typeof maxPlayers === 'number') fields.maxPlayers = maxPlayers;
        return this.mutate('lobby.create', fields, network);
    }

    lobbyJoin(lobby, network) {
        return this.mutate('lobby.join', { lobby }, network);
    }

    lobbyLeave(lobby, network) {
        return this.mutate('lobby.leave', { lobby }, network);
    }

    lobbyKick(lobby, nick, network) {
        return this.mutate('lobby.kick', { lobby, nick }, network);
    }

    lobbyLaunch(lobby, network) {
        return this.mutate('lobby.launch', { lobby }, network);
    }

    async mutate(op, fields, network) {
        this.state.error = '';
        try {
            const res = await this.client.request(op, fields, network);
            if (!res.ok) {
                this.state.error = res.error || t('mgmt_err_op', { op });
                return false;
            }

            this.applyMutation(op, fields, asObject(res.data), network);
            return true;
        } catch (err) {
            this.state.error = err instanceof Error ? err.message : String(err);
            return false;
        }
    }

    applyMutation(op, fields, data, network) {
        if (op === 'queue.join' || op === 'queue.leave') {
            this.applyQueuePatch(data, op === 'queue.join' ? 'joined' : 'left');
            return;
        }

        if (op === 'lobby.create' || op === 'lobby.join') {
            const lobby = data.lobby;
            if (lobby) {
                this.upsertLobby(lobby);
                this.addMeLobby(lobby.id);
                if (lobby.status === 'ready') {
                    const { id, game } = lobbyEventLabel(lobby);
                    postSalon(network, t('mgmt_push_ready', { id, game }));
                }
            }
            return;
        }

        if (op === 'lobby.leave') {
            if (data.closed) {
                this.removeLobby(data.lobbyId || data.id || fields.lobby, data.game);
            } else if (data.lobby) {
                this.upsertLobby(data.lobby);
            } else {
                this.applyLobbyUpdate(data);
            }
            this.removeMeLobby(data.lobbyId || data.id || (data.lobby && data.lobby.id) || fields.lobby);
            return;
        }

        if (op === 'lobby.kick') {
            if (data.lobby) this.upsertLobby(data.lobby);
            return;
        }

        if (op === 'lobby.launch') {
            const lobby = asObject(data.lobby);
            const id = lobby.id || fields.lobby;
            const nicks = (lobby.players || []).map((p) => p.nick).filter(Boolean);
            this.removeLobby(id, lobby.game);
            this.removeMeLobby(id);
            this.removeNicksFromQueues(nicks);
            if (lobby.id || id) {
                const { id: lid, game } = lobbyEventLabel(lobby, id);
                postSalon(network, t('mgmt_push_launched', { id: lid, game }));
            }
        }
    }

    applyQueuePatch(data, selfAction) {
        const gameId = data && data.game && String(data.game);
        if (!gameId) return;

        const action = selfAction || data.action;
        const nick = data.nick ? String(data.nick) : (selfAction && this.state.meNick) || '';
        if (!action || !nick) return;

        if (selfAction && nick && !this.state.meNick) {
            this.state.meNick = nick;
        }

        let list = (this.state.queues[gameId] || []).slice();
        const key = nick.toLowerCase();
        if (action === 'joined') {
            if (!list.some((p) => String(p.nick || '').toLowerCase() === key)) {
                list.push(normalizePlayer({ nick }));
            }
        } else if (action === 'left') {
            list = list.filter((p) => String(p.nick || '').toLowerCase() !== key);
        } else {
            return;
        }

        this.state.queues = { ...this.state.queues, [gameId]: list };

        const queueCount = typeof data.queueCount === 'number' ? data.queueCount : list.length;
        this.patchGameMeta(gameId, { queueCount });

        if (selfAction === 'joined') this.addMeQueue(gameId);
        if (selfAction === 'left') this.removeMeQueue(gameId);
        this.syncMeQueuesFromLists();
    }

    applyLobbyUpdate(data) {
        const id = data.id || data.lobbyId;
        const game = data.game;

        if (data.closed) {
            this.removeLobby(id, game);
            this.removeMeLobby(id);
            return;
        }

        this.patchLobby({
            id,
            game,
            status: data.status,
            players: data.players,
        }, game);
    }

    findLobby(lobbyId) {
        const id = String(lobbyId || '');
        if (!id) return null;
        return this.state.lobbiesOpen.concat(this.state.lobbiesReady)
            .find((l) => l.id === id) || null;
    }

    patchLobby(patch, fallbackGame) {
        const id = String((patch && (patch.id || patch.lobbyId)) || '');
        if (!id) return;
        const existing = this.findLobby(id);
        const nickList = compactPlayerNicks(patch.players);
        const players = nickList
            ? nickList.map((nick) => normalizePlayer(nick))
            : ((existing && existing.players) || []);
        this.upsertLobby({
            ...(existing || {}),
            id,
            game: patch.game || fallbackGame || (existing && existing.game) || '',
            label: (existing && existing.label) || '',
            maxPlayers: (existing && existing.maxPlayers) || 2,
            status: patch.status || (existing && existing.status) || 'open',
            createdBy: (existing && existing.createdBy) || '',
            createdAt: (existing && existing.createdAt) || '',
            completedAt: existing && existing.completedAt,
            launchCommand: (existing && existing.launchCommand) || '',
            players,
        });
    }

    upsertLobby(raw) {
        const lobby = normalizeLobby(raw);
        if (!lobby.id) return;
        this.state.lobbiesOpen = this.state.lobbiesOpen.filter((l) => l.id !== lobby.id);
        this.state.lobbiesReady = this.state.lobbiesReady.filter((l) => l.id !== lobby.id);
        if (lobby.status === 'ready') {
            this.state.lobbiesReady = this.state.lobbiesReady.concat([lobby]);
        } else {
            this.state.lobbiesOpen = this.state.lobbiesOpen.concat([lobby]);
        }
        this.recountOpenLobbies(lobby.game);
    }

    removeLobby(lobbyId, gameId) {
        const id = String(lobbyId || '');
        if (!id) return;
        const previous = this.state.lobbiesOpen.concat(this.state.lobbiesReady)
            .find((l) => l.id === id);
        const game = gameId || (previous && previous.game) || '';
        this.state.lobbiesOpen = this.state.lobbiesOpen.filter((l) => l.id !== id);
        this.state.lobbiesReady = this.state.lobbiesReady.filter((l) => l.id !== id);
        if (game) this.recountOpenLobbies(game);
    }

    patchGameMeta(gameId, fields) {
        this.state.games = this.state.games.map((g) => (
            g.id === gameId ? { ...g, ...fields } : g
        ));
    }

    recountOpenLobbies(gameId) {
        if (!gameId) return;
        const openLobbies = this.state.lobbiesOpen.filter((l) => l.game === gameId).length;
        this.patchGameMeta(gameId, { openLobbies });
    }

    addMeQueue(gameId) {
        const id = String(gameId || '');
        if (!id || this.state.meQueues.includes(id)) return;
        this.state.meQueues = this.state.meQueues.concat([id]);
    }

    removeMeQueue(gameId) {
        const id = String(gameId || '');
        this.state.meQueues = this.state.meQueues.filter((g) => g !== id);
    }

    addMeLobby(lobbyId) {
        const id = String(lobbyId || '');
        if (!id || this.state.meLobbies.includes(id)) return;
        this.state.meLobbies = this.state.meLobbies.concat([id]);
    }

    removeMeLobby(lobbyId) {
        const id = String(lobbyId || '');
        if (!id) return;
        this.state.meLobbies = this.state.meLobbies.filter((l) => l !== id);
    }

    removeNicksFromQueues(nicks) {
        const keys = new Set(
            (nicks || []).map((n) => String(n || '').toLowerCase()).filter(Boolean)
        );
        if (!keys.size) return;

        const queues = { ...this.state.queues };
        Object.keys(queues).forEach((gameId) => {
            const prev = queues[gameId] || [];
            const next = prev.filter((p) => !keys.has(String(p.nick || '').toLowerCase()));
            if (next.length !== prev.length) {
                queues[gameId] = next;
                this.patchGameMeta(gameId, { queueCount: next.length });
            }
        });
        this.state.queues = queues;
        this.syncMeQueuesFromLists();
    }

    syncMeQueuesFromLists() {
        const myNick = String(this.state.meNick || '').toLowerCase();
        if (!myNick) return;
        this.state.meQueues = Object.keys(this.state.queues).filter((gameId) => (
            (this.state.queues[gameId] || []).some(
                (p) => String(p.nick || '').toLowerCase() === myNick
            )
        ));
    }

    applyState(data) {
        if (Array.isArray(data.games) && data.games.length) {
            this.state.games = data.games
                .filter((g) => g && isGameEnabled(String(g.id)))
                .map((g) => {
                    const id = String(g.id);
                    return {
                        id,
                        label: GAME_LABELS[id] || String(g.label || id),
                        minPlayers: Number(g.minPlayers) || 2,
                        maxPlayers: Number(g.maxPlayers) || 2,
                        queueCount: Number(g.queueCount) || 0,
                        openLobbies: Number(g.openLobbies) || 0,
                    };
                });
        }

        const queues = {};
        if (data.queues && typeof data.queues === 'object') {
            Object.keys(data.queues).forEach((gameId) => {
                const list = data.queues[gameId];
                queues[gameId] = Array.isArray(list) ? list.map(normalizePlayer) : [];
            });
        }
        this.state.queues = queues;

        this.state.lobbiesOpen = Array.isArray(data.lobbies && data.lobbies.open)
            ? data.lobbies.open.map(normalizeLobby)
            : [];
        this.state.lobbiesReady = Array.isArray(data.lobbies && data.lobbies.ready)
            ? data.lobbies.ready.map(normalizeLobby)
            : [];

        if (data.me && typeof data.me === 'object') {
            this.applyMe(data.me);
        }
    }

    applyMe(data) {
        this.state.meNick = typeof data.nick === 'string' ? data.nick : '';
        this.state.meAccount = typeof data.account === 'string' ? data.account : '';
        this.state.meQueues = Array.isArray(data.queues) ? data.queues.map(String) : [];
        this.state.meLobbies = Array.isArray(data.lobbies)
            ? data.lobbies.map((l) => String((l && l.id) || l || '')).filter(Boolean)
            : [];
    }
}


let storeInstance = null;

export function initGameStore(client) {
    storeInstance = new GameStore(client);
    return storeInstance;
}

export function getGameStore() {
    if (!storeInstance) {
        throw new Error('GameStore not initialized');
    }
    return storeInstance;
}
