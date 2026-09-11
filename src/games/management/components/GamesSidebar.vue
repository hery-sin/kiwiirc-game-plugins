<template>
    <div class="kiwi-gm-sidebar">
        <div class="kiwi-gm-sidebar-header">
            <div class="kiwi-gm-sidebar-title">{{ $t('kiwi-games:mgmt_title') }}</div>
            <button
                type="button"
                class="kiwi-gm-btn kiwi-gm-btn--icon"
                :title="state.refreshLocked ? $t('kiwi-games:mgmt_refresh_wait') : $t('kiwi-games:mgmt_refresh')"
                :disabled="state.loading || state.refreshLocked"
                @click="refresh"
            >↻</button>
        </div>

        <div v-if="!identified" class="kiwi-gm-banner kiwi-gm-banner--warn">
            {{ $t('kiwi-games:mgmt_nickserv_required') }}
        </div>

        <div v-if="state.error" class="kiwi-gm-banner kiwi-gm-banner--error">
            {{ state.error }}
        </div>

        <div v-if="state.loading && !games.length" class="kiwi-gm-empty">
            {{ $t('kiwi-games:mgmt_loading') }}
        </div>

        <ul class="kiwi-gm-game-list">
            <li
                v-for="game in games"
                :key="game.id"
                class="kiwi-gm-game"
                :class="{ 'kiwi-gm-game--open': expandedGame === game.id }"
            >
                <div
                    class="kiwi-gm-game-row"
                    role="button"
                    tabindex="0"
                    @click="toggleGame(game.id)"
                    @keydown.enter.space.prevent="toggleGame(game.id)"
                >
                    <span class="kiwi-gm-game-namebtn">
                        <span class="kiwi-gm-game-chevron" aria-hidden="true">{{ expandedGame === game.id ? '▾' : '▸' }}</span>
                        {{ gameTitle(game) }}
                    </span>
                    <button
                        type="button"
                        class="kiwi-gm-scores-btn"
                        :class="{ 'kiwi-gm-scores-btn--open': isScoresOpen(game.id) }"
                        :title="$t('kiwi-games:mgmt_scores_title')"
                        @click.stop="toggleScores(game.id)"
                    >🏆</button>
                    <span
                        class="kiwi-gm-game-metabtn"
                    >
                        <span :title="$t('kiwi-games:mgmt_queue_title')">👥 {{ game.queueCount }}</span>
                        <span :title="$t('kiwi-games:mgmt_lobbies_open')">🏠 {{ game.openLobbies }}</span>
                    </span>
                </div>

                <div v-if="isScoresOpen(game.id)" class="kiwi-gm-scores">
                    <div class="kiwi-gm-scores-head">
                        <h3>{{ $t('kiwi-games:mgmt_scores_title') }}
                            <span v-if="scoresFor(game.id).label">— {{ scoresFor(game.id).label }}</span>
                        </h3>
                        <button
                            type="button"
                            class="kiwi-gm-btn kiwi-gm-btn--icon"
                            :title="scoresFor(game.id).locked ? $t('kiwi-games:mgmt_refresh_wait') : $t('kiwi-games:mgmt_refresh')"
                            :disabled="scoresFor(game.id).loading || scoresFor(game.id).locked"
                            @click="refreshScores(game.id)"
                        >↻</button>
                    </div>
                    <p v-if="scoresFor(game.id).loading" class="kiwi-gm-empty">
                        {{ $t('kiwi-games:mgmt_loading') }}
                    </p>
                    <p v-else-if="scoresFor(game.id).error" class="kiwi-gm-banner kiwi-gm-banner--error kiwi-gm-scores-error">
                        {{ scoresFor(game.id).error }}
                    </p>
                    <template v-else>
                        <ol v-if="scoresFor(game.id).top.length" class="kiwi-gm-scores-list">
                            <li
                                v-for="row in scoresFor(game.id).top"
                                :key="'top-' + row.rank + '-' + row.account"
                                class="kiwi-gm-scores-row"
                                :class="{ 'kiwi-gm-scores-row--me': isMeScore(row) }"
                            >
                                <span class="kiwi-gm-scores-rank">#{{ row.rank }}</span>
                                <span class="kiwi-gm-scores-name">{{ row.account }}</span>
                                <span class="kiwi-gm-scores-stats" :title="scoreStatsTitle(row)">
                                    {{ formatScoreStats(row) }}
                                </span>
                                <span class="kiwi-gm-scores-ratio">{{ row.ratio }}%</span>
                            </li>
                        </ol>
                        <p v-else class="kiwi-gm-empty">{{ $t('kiwi-games:mgmt_scores_empty') }}</p>
                        <div
                            v-if="scoresMeExtra(game.id)"
                            class="kiwi-gm-scores-me"
                        >
                            <div class="kiwi-gm-scores-row kiwi-gm-scores-row--me">
                                <span class="kiwi-gm-scores-rank">#{{ scoresMeExtra(game.id).rank }}</span>
                                <span class="kiwi-gm-scores-name">{{ scoresMeExtra(game.id).account }}</span>
                                <span class="kiwi-gm-scores-stats" :title="scoreStatsTitle(scoresMeExtra(game.id))">
                                    {{ formatScoreStats(scoresMeExtra(game.id)) }}
                                </span>
                                <span class="kiwi-gm-scores-ratio">{{ scoresMeExtra(game.id).ratio }}%</span>
                            </div>
                        </div>
                    </template>
                </div>

                <div v-if="expandedGame === game.id" class="kiwi-gm-game-body">
                    <section class="kiwi-gm-section">
                        <div class="kiwi-gm-section-head">
                            <h3>{{ $t('kiwi-games:mgmt_queue_title') }}</h3>
                            <button
                                v-if="!inQueue(game.id)"
                                type="button"
                                class="kiwi-gm-btn"
                                :disabled="state.loading"
                                @click="joinQueue(game.id)"
                            >{{ $t('kiwi-games:mgmt_join') }}</button>
                            <button
                                v-else
                                type="button"
                                class="kiwi-gm-btn kiwi-gm-btn--danger"
                                :disabled="state.loading"
                                @click="leaveQueue(game.id)"
                            >{{ $t('kiwi-games:mgmt_leave') }}</button>
                        </div>
                        <ul v-if="queueFor(game.id).length" class="kiwi-gm-players">
                            <li
                                v-for="p in queueFor(game.id)"
                                :key="p.account + p.nick"
                                class="kiwi-gm-player"
                            >
                                <span class="kiwi-gm-player-name">{{ p.nick || p.account }}</span>
                                <button
                                    v-if="inQueue(game.id) && !isSelf(p)"
                                    type="button"
                                    class="kiwi-gm-btn kiwi-gm-btn--small"
                                    :disabled="state.loading || queueInvitesLocked"
                                    :title="queueInvitesLocked ? $t('kiwi-games:mgmt_invite_cooldown') : ''"
                                    @click="invitePlayer(game.id, p.nick || p.account)"
                                >{{ $t('kiwi-games:mgmt_invite') }}</button>
                            </li>
                        </ul>
                        <p v-else class="kiwi-gm-empty">{{ $t('kiwi-games:mgmt_queue_empty') }}</p>
                    </section>

                    <section class="kiwi-gm-section">
                        <div class="kiwi-gm-section-head">
                            <h3>{{ $t('kiwi-games:mgmt_lobbies_title') }}</h3>
                            <div class="kiwi-gm-create">
                                <label v-if="game.id === 'pictionary'" class="kiwi-gm-max">
                                    {{ $t('kiwi-games:mgmt_max') }}
                                    <input
                                        v-model.number="createMaxPlayers"
                                        type="number"
                                        min="2"
                                        max="10"
                                    >
                                </label>
                                <button
                                    type="button"
                                    class="kiwi-gm-btn"
                                    :disabled="state.loading"
                                    @click="createLobby(game.id)"
                                >{{ $t('kiwi-games:mgmt_create') }}</button>
                            </div>
                        </div>

                        <ul v-if="lobbiesFor(game.id).length" class="kiwi-gm-lobbies">
                            <li
                                v-for="lobby in lobbiesFor(game.id)"
                                :key="lobby.id"
                                class="kiwi-gm-lobby"
                            >
                                <div class="kiwi-gm-lobby-info">
                                    <strong>#{{ lobby.id }}</strong>
                                    <span>{{ lobby.players.length }}/{{ lobby.maxPlayers }}</span>
                                    <span
                                        v-if="isLobbyReady(lobby)"
                                        class="kiwi-gm-badge"
                                    >{{ $t('kiwi-games:mgmt_ready') }}</span>
                                    <span class="kiwi-gm-lobby-players">
                                        <span
                                            v-for="p in lobby.players"
                                            :key="(p.nick || p.account) + p.joinedAt"
                                            class="kiwi-gm-lobby-player"
                                        >
                                            <span class="kiwi-gm-lobby-player-name">{{ p.nick || p.account }}</span>
                                            <button
                                                v-if="canKick(lobby, p)"
                                                type="button"
                                                class="kiwi-gm-kick"
                                                :disabled="state.loading"
                                                :title="$t('kiwi-games:mgmt_kick')"
                                                @click="kickPlayer(lobby, p)"
                                            >×</button>
                                        </span>
                                    </span>
                                </div>
                                <div class="kiwi-gm-lobby-actions">
                                    <button
                                        v-if="!inLobby(lobby.id) && !isLobbyReady(lobby)"
                                        type="button"
                                        class="kiwi-gm-btn kiwi-gm-btn--small"
                                        :disabled="state.loading || isLobbyFull(lobby)"
                                        @click="joinLobby(lobby.id)"
                                    >{{ $t('kiwi-games:mgmt_join') }}</button>
                                    <template v-else-if="inLobby(lobby.id)">
                                        <button
                                            v-if="canLaunch(lobby)"
                                            type="button"
                                            class="kiwi-gm-btn kiwi-gm-btn--small"
                                            :disabled="state.loading"
                                            @click="launchLobby(game.id, lobby)"
                                        >{{ $t('kiwi-games:mgmt_launch') }}</button>
                                        <span
                                            v-else-if="isLobbyFull(lobby) || isLobbyReady(lobby)"
                                            class="kiwi-gm-waiting"
                                        >{{ $t('kiwi-games:mgmt_waiting_launch') }}</span>
                                        <button
                                            type="button"
                                            class="kiwi-gm-btn kiwi-gm-btn--small kiwi-gm-btn--danger"
                                            :disabled="state.loading"
                                            @click="leaveLobby(lobby.id)"
                                        >{{ $t('kiwi-games:mgmt_leave') }}</button>
                                    </template>
                                </div>
                            </li>
                        </ul>
                        <p v-else class="kiwi-gm-empty">{{ $t('kiwi-games:mgmt_lobbies_empty') }}</p>
                    </section>
                </div>
            </li>
        </ul>
    </div>
</template>

<script>
/* global kiwi:true */
import { getGameStore } from '../libs/game-store.js';
import { isIdentified, nicksMatch } from '../libs/network.js';

export default {
    props: {
        buffer: { type: Object, default: null },
        network: { type: Object, default: null },
        sidebarState: { type: Object, default: null },
        pluginId: { type: String, default: '' },
    },
    data() {
        return {
            store: getGameStore(),
            createMaxPlayers: 4,
            expandedGame: '',
        };
    },
    created() {
        this.expandedGame = this.store.state.expandedGame || '';
    },
    computed: {
        state() {
            return this.store.state;
        },
        identified() {
            return isIdentified(this.network);
        },
        games() {
            return this.state.games;
        },
        queueInvitesLocked() {
            return Boolean(this.state.queueInviteLocked);
        },
    },
    methods: {
        refresh() {
            this.store.refresh(this.network);
        },
        toggleGame(gameId) {
            const next = this.expandedGame === gameId ? '' : gameId;
            this.expandedGame = next;
            this.store.setExpanded(next);
        },
        gameTitle(game) {
            const id = game && game.id;
            if (!id) return '';
            const key = 'kiwi-games:dropdown_' + id;
            const translated = this.$t(key);
            if (translated && translated !== key) return translated;
            return (game && game.label) || id;
        },
        toggleScores(gameId) {
            this.store.toggleScores(gameId, this.network);
        },
        refreshScores(gameId) {
            this.store.fetchScores(gameId, this.network);
        },
        isScoresOpen(gameId) {
            return this.store.isScoresOpen(gameId);
        },
        scoresFor(gameId) {
            return this.store.scoresFor(gameId);
        },
        isMeScore(row) {
            if (!row || !row.account) return false;
            const scores = this.scoresFor(this.state.scoresOpenGame);
            const meAccount = this.state.meAccount
                || (scores.me && scores.me.account)
                || '';
            if (!meAccount) return false;
            return meAccount.toLowerCase() === String(row.account).toLowerCase();
        },
        scoresMeExtra(gameId) {
            const scores = this.scoresFor(gameId);
            const me = scores.me;
            if (!me || !me.account) return null;
            const inTop = (scores.top || []).some((row) => (
                row.account
                && row.account.toLowerCase() === me.account.toLowerCase()
            ));
            return inTop ? null : me;
        },
        formatScoreStats(row) {
            if (!row) return '';
            return `${row.wins}V ${row.draws}N ${row.losses}D`;
        },
        scoreStatsTitle(row) {
            if (!row) return '';
            return this.$t('kiwi-games:mgmt_scores_stats', {
                wins: row.wins,
                draws: row.draws,
                losses: row.losses,
                games: row.games,
            });
        },
        queueFor(gameId) {
            return this.store.queueFor(gameId);
        },
        lobbiesFor(gameId) {
            return this.store.lobbiesFor(gameId);
        },
        inQueue(gameId) {
            if (this.store && typeof this.store.isInQueue === 'function') {
                return this.store.isInQueue(gameId);
            }
            const queues = this.state && this.state.meQueues;
            return Array.isArray(queues) && queues.includes(gameId);
        },
        inLobby(lobbyId) {
            if (this.store && typeof this.store.isInLobby === 'function') {
                return this.store.isInLobby(lobbyId);
            }
            const lobbies = this.state && this.state.meLobbies;
            return Array.isArray(lobbies) && lobbies.includes(lobbyId);
        },
        isSelf(player) {
            const meAccount = this.state.meAccount;
            if (meAccount && player.account && meAccount.toLowerCase() === String(player.account).toLowerCase()) {
                return true;
            }
            const myNick = (this.network && this.network.nick) || this.state.meNick;
            const theirNick = player.nick || player.account;
            const irc = this.network && this.network.ircClient;
            return nicksMatch(myNick, theirNick, irc);
        },
        isCreator(lobby) {
            const myNick = (this.network && this.network.nick) || this.state.meNick;
            const irc = this.network && this.network.ircClient;
            return nicksMatch(lobby && lobby.createdBy, myNick, irc);
        },
        isLobbyReady(lobby) {
            return Boolean(lobby && lobby.status === 'ready');
        },
        canKick(lobby, player) {
            if (!lobby || !player) return false;
            if (!this.isCreator(lobby) || this.isSelf(player)) return false;
            return Boolean((player.nick || player.account || '').trim());
        },
        canLaunch(lobby) {
            return this.isLobbyFull(lobby) && this.isCreator(lobby) && this.inLobby(lobby.id);
        },
        invitePlayer(gameId, nick) {
            const network = this.network;
            const buffer = this.buffer;
            const target = (nick || '').trim();
            if (!network || !buffer || !target) return;
            if (this.store.isQueueInviteLocked()) return;
            const evt = { handled: false, params: [target] };
            const ctx = { network, buffer };
            kiwi.emit(`input.command.${gameId}`, evt, gameId, target, ctx);
            this.store.lockQueueInvites();
        },
        isLobbyFull(lobby) {
            const max = Number(lobby && lobby.maxPlayers) || 0;
            const count = (lobby && lobby.players && lobby.players.length) || 0;
            return max > 0 && count >= max;
        },
        parseLaunchCommand(cmd) {
            if (!cmd || typeof cmd !== 'string') return null;
            const cleaned = cmd.replace(/^\//, '').trim();
            const parts = cleaned.split(/\s+/).filter(Boolean);
            if (parts.length < 2) return null;
            return { game: parts[0], nicks: parts.slice(1) };
        },
        runLaunchCommand(gameId, lobby) {
            const network = this.network;
            const buffer = this.buffer;
            if (!network || !buffer || !lobby) return;

            const parsed = this.parseLaunchCommand(lobby.launchCommand);
            const game = (parsed && parsed.game) || gameId;
            const nicks = parsed && parsed.nicks.length
                ? parsed.nicks.slice()
                : (lobby.players || [])
                    .filter((p) => !this.isSelf(p))
                    .map((p) => (p.nick || p.account || '').trim())
                    .filter(Boolean);
            if (!nicks.length) return;

            const paramsArg = nicks.join(' ');
            const evt = { handled: false, params: nicks.slice() };
            const ctx = { network, buffer };
            kiwi.emit(`input.command.${game}`, evt, game, paramsArg, ctx);
        },
        kickPlayer(lobby, player) {
            const nick = ((player && player.nick) || (player && player.account) || '').trim();
            if (!lobby || !nick) return;
            return this.store.lobbyKick(lobby.id, nick, this.network);
        },
        async launchLobby(gameId, lobby) {
            if (!lobby) return;
            const snapshot = {
                launchCommand: lobby.launchCommand,
                players: (lobby.players || []).slice(),
            };
            const ok = await this.store.lobbyLaunch(lobby.id, this.network);
            if (!ok) return;
            this.runLaunchCommand(gameId, snapshot);
        },
        joinQueue(gameId) {
            return this.store.queueJoin(gameId, this.network);
        },
        leaveQueue(gameId) {
            return this.store.queueLeave(gameId, this.network);
        },
        createLobby(gameId) {
            const max = gameId === 'pictionary' ? Number(this.createMaxPlayers) || 4 : undefined;
            return this.store.lobbyCreate(gameId, max, this.network);
        },
        joinLobby(lobbyId) {
            return this.store.lobbyJoin(lobbyId, this.network);
        },
        leaveLobby(lobbyId) {
            return this.store.lobbyLeave(lobbyId, this.network);
        },
        close() {
            if (this.sidebarState && typeof this.sidebarState.close === 'function') {
                this.sidebarState.close();
            }
        },
    },
};
</script>

<style>
.kiwi-gm-sidebar {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    font-size: 0.92em;
}

.kiwi-gm-sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5em;
    padding: 0.65em 0.75em;
    border-bottom: 1px solid rgba(128, 128, 128, 0.25);
    flex-shrink: 0;
}

.kiwi-gm-sidebar-title {
    font-weight: 600;
    letter-spacing: 0.02em;
}

.kiwi-gm-banner {
    margin: 0.5em 0.75em 0;
    padding: 0.45em 0.6em;
    border-radius: 3px;
    font-size: 0.88em;
    line-height: 1.35;
    flex-shrink: 0;
}

.kiwi-gm-banner--warn {
    background: rgba(200, 140, 0, 0.15);
    border: 1px solid rgba(200, 140, 0, 0.35);
}

.kiwi-gm-banner--error {
    background: rgba(180, 40, 40, 0.12);
    border: 1px solid rgba(180, 40, 40, 0.35);
}

.kiwi-gm-game-list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
}

.kiwi-gm-game {
    border-bottom: 1px solid rgba(128, 128, 128, 0.18);
}

.kiwi-gm-game-row {
    display: flex;
    align-items: stretch;
    cursor: pointer;
}

.kiwi-gm-game-namebtn,
.kiwi-gm-game-metabtn {
    display: flex;
    align-items: center;
    gap: 0.65em;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    font: inherit;
    padding: 0.65em 0.35em;
}

.kiwi-gm-game-namebtn {
    flex: 1;
    padding-left: 0.75em;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.kiwi-gm-game-chevron {
    display: inline-block;
    width: 0.9em;
    flex-shrink: 0;
    opacity: 0.65;
    font-size: 0.85em;
}

.kiwi-gm-game-metabtn {
    margin-left: auto;
    padding-right: 0.75em;
    opacity: 0.8;
    font-size: 0.88em;
    white-space: nowrap;
}

.kiwi-gm-game-row:hover {
    background: rgba(128, 128, 128, 0.1);
}

.kiwi-gm-game--open > .kiwi-gm-game-row > .kiwi-gm-game-namebtn {
    font-weight: 600;
}

.kiwi-gm-game--open > .kiwi-gm-game-row > .kiwi-gm-game-namebtn,
.kiwi-gm-game--open > .kiwi-gm-game-row > .kiwi-gm-game-metabtn {
    background: rgba(128, 128, 128, 0.12);
}

.kiwi-gm-scores-btn {
    appearance: none;
    border: 0;
    background: transparent;
    padding: 0 0.25em;
    margin: 0;
    font: inherit;
    font-size: 1em;
    line-height: 1;
    cursor: pointer;
    opacity: 0.65;
    flex-shrink: 0;
}

.kiwi-gm-scores-btn:hover,
.kiwi-gm-scores-btn--open {
    opacity: 1;
    background: rgba(128, 128, 128, 0.1);
}

.kiwi-gm-scores {
    padding: 0.35em 0.75em 0.75em;
    border-top: 1px dashed rgba(128, 128, 128, 0.2);
}

.kiwi-gm-scores-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5em;
    margin-bottom: 0.35em;
}

.kiwi-gm-scores-head h3 {
    margin: 0;
    font-size: 0.85em;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.75;
}

.kiwi-gm-scores-error {
    margin: 0.35em 0 0;
}

.kiwi-gm-scores-list {
    list-style: none;
    margin: 0;
    padding: 0;
}

.kiwi-gm-scores-row {
    display: grid;
    grid-template-columns: 2.2em 1fr auto auto;
    gap: 0.45em;
    align-items: center;
    padding: 0.2em 0;
    font-size: 0.9em;
}

.kiwi-gm-scores-row--me {
    font-weight: 600;
}

.kiwi-gm-scores-rank {
    opacity: 0.7;
    font-variant-numeric: tabular-nums;
}

.kiwi-gm-scores-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.kiwi-gm-scores-stats {
    opacity: 0.75;
    font-size: 0.88em;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
}

.kiwi-gm-scores-ratio {
    opacity: 0.85;
    font-variant-numeric: tabular-nums;
    min-width: 2.6em;
    text-align: right;
}

.kiwi-gm-scores-me {
    margin-top: 0.35em;
    padding-top: 0.35em;
    border-top: 1px solid rgba(128, 128, 128, 0.2);
}

.kiwi-gm-game-body {
    padding: 0 0.75em 0.85em;
}

.kiwi-gm-section {
    margin-top: 0.65em;
}

.kiwi-gm-section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5em;
    margin-bottom: 0.35em;
}

.kiwi-gm-section-head h3 {
    margin: 0;
    font-size: 0.85em;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.75;
}

.kiwi-gm-players,
.kiwi-gm-lobbies {
    list-style: none;
    margin: 0;
    padding: 0;
}

.kiwi-gm-player {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5em;
    padding: 0.25em 0;
    opacity: 0.95;
}

.kiwi-gm-player-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.kiwi-gm-lobby {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5em;
    padding: 0.4em 0;
    border-top: 1px solid rgba(128, 128, 128, 0.12);
}

.kiwi-gm-lobby:first-child {
    border-top: 0;
}

.kiwi-gm-lobby-info {
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35em 0.55em;
}

.kiwi-gm-lobby-actions {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.25em;
    flex-shrink: 0;
}

.kiwi-gm-lobby-players {
    font-size: 0.88em;
    opacity: 0.9;
    flex-basis: 100%;
    display: flex;
    flex-wrap: wrap;
    gap: 0.2em 0.55em;
}

.kiwi-gm-lobby-player {
    display: inline-flex;
    align-items: center;
    gap: 0.1em;
    max-width: 100%;
}

.kiwi-gm-lobby-player-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.kiwi-gm-kick {
    appearance: none;
    border: 0;
    background: transparent;
    color: inherit;
    opacity: 0.4;
    cursor: pointer;
    padding: 0 0.12em;
    margin: 0;
    font: inherit;
    font-size: 1.05em;
    line-height: 1;
    border-radius: 2px;
}

.kiwi-gm-kick:hover:not(:disabled) {
    opacity: 1;
    color: #c0392b;
}

.kiwi-gm-kick:disabled {
    opacity: 0.2;
    cursor: not-allowed;
}

.kiwi-gm-badge {
    font-size: 0.72em;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 0.1em 0.4em;
    border-radius: 3px;
    background: rgba(40, 140, 70, 0.18);
    border: 1px solid rgba(40, 140, 70, 0.4);
}

.kiwi-gm-waiting {
    font-size: 0.78em;
    opacity: 0.7;
    font-style: italic;
    max-width: 8.5em;
    line-height: 1.25;
}

.kiwi-gm-empty {
    margin: 0.25em 0 0;
    opacity: 0.65;
    font-style: italic;
    font-size: 0.9em;
    padding: 0 0.75em;
}

.kiwi-gm-create {
    display: flex;
    align-items: center;
    gap: 0.4em;
}

.kiwi-gm-max {
    display: flex;
    align-items: center;
    gap: 0.25em;
    font-size: 0.85em;
    opacity: 0.85;
}

.kiwi-gm-max input {
    width: 3em;
    padding: 0.15em 0.25em;
    border: 1px solid rgba(128, 128, 128, 0.35);
    border-radius: 3px;
    background: transparent;
    color: inherit;
    font: inherit;
}

.kiwi-gm-btn {
    appearance: none;
    border: 1px solid rgba(128, 128, 128, 0.4);
    background: rgba(128, 128, 128, 0.08);
    color: inherit;
    border-radius: 3px;
    padding: 0.25em 0.55em;
    font: inherit;
    font-size: 0.85em;
    cursor: pointer;
    white-space: nowrap;
}

.kiwi-gm-btn:hover:not(:disabled) {
    background: rgba(128, 128, 128, 0.18);
}

.kiwi-gm-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}

.kiwi-gm-btn--small {
    padding: 0.15em 0.45em;
    font-size: 0.8em;
}

.kiwi-gm-btn--danger {
    border-color: rgba(180, 60, 60, 0.45);
}

.kiwi-gm-btn--icon {
    padding: 0.15em 0.4em;
    font-size: 1.1em;
    line-height: 1;
}
</style>
