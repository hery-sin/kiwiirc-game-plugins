# Game management — bot protocol

This sub-plugin is **not standalone**. It talks to an IRC bot (default nick `gameMaster`) that owns queues and lobbies. Without a compatible bot, the sidebar UI will load but every request will time out or fail.

Build note: management is **opt-in**. Include it with:

```bash
yarn build --env include=management
```

## Kiwi config

Under `plugin_kiwi_games.management`:

| Key | Default | Description |
|---|---|---|
| `enabled` | `true` | Runtime toggle |
| `button` | `true` | Channel header button |
| `salon` | `#jeux` | Channel where the header button appears |
| `gameMasterNick` | `gameMaster` | Bot nick to send TAGMSG to |
| `requestTimeoutMs` | `8000` | Client-side request timeout |

## Transport

- **Direction:** client ↔ bot only (not peer-to-peer).
- **IRC command:** `TAGMSG`
- **Tag:** `+gm` (client also accepts `+GM` on receive)
- **Target:** the bot nick (`gameMasterNick`)
- **Payload:** JSON encoded as **base64url** (UTF-8) in the tag value

Example (conceptual):

```
TAGMSG gameMaster +gm=<base64url(JSON)>
```

The client only accepts responses whose `nick` matches `gameMasterNick` (IRC case rules when available).

Before any private TAGMSG to the bot, the client checks that the nick is online: salon nicklist if the bot is already in the channel, otherwise **`ISON`**. If the nick is missing, **nothing is sent** (avoids `401 No such nick` spam). The result is cached for a few seconds.

## Request (client → bot)

```json
{
  "id": "<uuid>",
  "op": "state | me | queue.join | queue.leave | lobby.create | lobby.join | lobby.leave | lobby.kick | lobby.launch | start | game.start | scores",
  "game": "<gameId>",
  "lobby": "<lobbyId>",
  "nick": "<nick>",
  "maxPlayers": 4
}
```

| Field | When |
|---|---|
| `id` | Always — correlation id for the response |
| `op` | Always |
| `game` | `queue.*`, `lobby.create`, `scores` |
| `lobby` | `lobby.join`, `lobby.leave`, `lobby.kick`, `lobby.launch` |
| `nick` | `lobby.kick` — player to exclude |
| `maxPlayers` | Optional on `lobby.create` (e.g. Pictionary) |
| `players` | `start` / `game.start` — nicks in the match (sender must be one of them) |

Known `game` ids: `pictionary`, `connectfour`, `tictactoe`, `chess`, `battleship`.

### Operations the bot must handle

| `op` | Meaning |
|---|---|
| `state` | Snapshot: games, queues, open/ready lobbies, plus `me` (requester's queues/lobbies) |
| `me` | Current user: nick, NickServ account, queues/lobbies they are in |
| `queue.join` | Join the wait queue for `game` |
| `queue.leave` | Leave that queue |
| `lobby.create` | Create an open lobby for `game` |
| `lobby.join` | Join lobby `lobby` |
| `lobby.leave` | Leave lobby `lobby` (also allowed when `ready`; lobby becomes `open` if a slot frees) |
| `lobby.kick` | Creator only: exclude `nick` from the lobby (also allowed when `ready`) |
| `lobby.launch` | Creator only: close a **ready** lobby, drop members from queues, then the client starts the P2P game |
| `start` / `game.start` | Remove listed nicks from all queues and lobbies (P2P invite accepted, or salon broadcast) |
| `scores` | Leaderboard for `game` (top entries + requester `me`) |

Queues and lobbies are keyed by **nick**. NickServ is required only to persist scores; unidentified players can still queue and lobby.

`state` includes `me` (the requester's queues and lobbies). The standalone `me` op remains for older bots. The client requests `state` only when the sidebar opens and on manual refresh (↻). Extra open/refresh clicks while a request is in flight, or within **8 seconds**, are ignored (no second `state`). After `queue.join` / `leave` (and lobby mutations) it applies the response locally and does **not** re-fetch `state`. The scores ↻ button uses the same 8s cooldown.

When a P2P game starts, the client sends `game.start` **privately** to the bot (same for `game.result`). Never TAGMSG the salon: every plugin client in the channel would see it.

### Pushed ops (bot → client, no request `id`)

| `op` | Who receives it | Client action |
|---|---|---|
| `queue.update` | Other nicks already in that queue | Delta only: `{ game, action, nick, queueCount }`. Add/remove that nick. Same shape on the `queue.join` / `leave` response. On `joined`, salon system line |
| `lobby.update` | Remaining members + that game's queue (not nicks who already got ready/open/kicked/launched) | Compact only: `{ id, game, status, players: [nicks] }` or `{ id, closed: true }` |
| `lobby.ready` | Other lobby members (not the nick that filled the lobby) | Full lobby (includes `launchCommand`) + salon system line |
| `lobby.open` | Other remaining members after a leave or kick frees a slot | Compact `{ id, status: "open", players: [nicks] }` + salon system line |
| `lobby.kicked` | The excluded player | `{ id }` / `{ lobbyId }` — drop from `me` and local list + salon system line |
| `lobby.launched` | Other **members** after `lobby.launch` (one notif each). Queue watchers get `lobby.update` `{ id, closed: true }` instead | `{ id }` — remove lobby using the local player list + salon system line |
| `start` | Nicks removed by `game.start` | Drop those nicks/lobbies locally + salon system line |

Do **not** follow a push with a `state` request. The client never sends `notifySalon` or any other TAGMSG to the channel.

A `ready` lobby stays listed until the creator clicks **Lancer**: the client sends `lobby.launch`, then runs `launchCommand` (or invites the other members via `input.command.<game>`).

## Response (bot → client)

Single message:

```json
{
  "id": "<same as request>",
  "ok": true,
  "op": "state",
  "data": { }
}
```

On failure:

```json
{
  "id": "<same as request>",
  "ok": false,
  "op": "queue.join",
  "error": "human-readable reason"
}
```

### Chunked responses (optional)

If the payload is too large for one TAGMSG, send several envelopes with the **same** `id`:

```json
{ "id": "<uuid>", "part": 1, "parts": 3, "chunk": "<base64url fragment>" }
{ "id": "<uuid>", "part": 2, "parts": 3, "chunk": "<base64url fragment>" }
{ "id": "<uuid>", "part": 3, "parts": 3, "chunk": "<base64url fragment>" }
```

`part` is 1-based. The client concatenates `chunk` values in order, then base64url-decodes the result as the final JSON response (`ok` / `data` / …).

## `data` shapes

### `state`

```json
{
  "games": [
    {
      "id": "chess",
      "label": "Chess",
      "minPlayers": 2,
      "maxPlayers": 2,
      "queueCount": 1,
      "openLobbies": 0
    }
  ],
  "queues": {
    "chess": [
      { "account": "alice", "nick": "Alice", "joinedAt": "2026-01-01T12:00:00Z" }
    ]
  },
  "lobbies": {
    "open": [
      {
        "id": "42",
        "game": "pictionary",
        "label": "Pictionary",
        "maxPlayers": 4,
        "status": "open",
        "createdBy": "bob",
        "createdAt": "2026-01-01T12:00:00Z",
        "completedAt": null,
        "players": [
          { "nick": "Bob", "joinedAt": "2026-01-01T12:00:00Z" }
        ],
        "launchCommand": null
      }
    ],
    "ready": []
  },
  "me": {
    "nick": "Alice",
    "queues": ["chess"],
    "lobbies": [{ "id": "42" }]
  }
}
```

### `me`

```json
{
  "nick": "Alice",
  "account": "alice",
  "queues": ["chess"],
  "lobbies": [{ "id": "42" }]
}
```

(`lobbies` may be full lobby objects; the client only needs each `id`.)

### `scores`

```json
{
  "game": "chess",
  "label": "Échecs",
  "top": [
    { "rank": 1, "account": "hery", "wins": 10, "draws": 2, "losses": 2, "games": 14, "ratio": 83 }
  ],
  "me": { "rank": 27, "account": "alice", "wins": 2, "draws": 1, "losses": 6, "games": 9, "ratio": 25 }
}
```

The UI shows the first 5 entries of `top`. If `me` is already among those five, it is highlighted in place and not repeated below.

### `queue.update` (push)

```json
{ "game": "tictactoe", "action": "joined", "nick": "Alice", "queueCount": 3 }
```

`action` is `joined` or `left`. The client adds/removes `nick` on its existing list. There is no `queue` array on this push or on the `queue.join` / `leave` response.

### `lobby.update` (push)

```json
{ "id": "42", "game": "pictionary", "status": "open", "players": ["Bob", "Alice"] }
```

```json
{ "id": "42", "closed": true }
```

`game` should be present when the receiver may not already know the lobby (queue watchers). `players` is a list of nick **strings**. A full lobby object is **not** accepted here — only on `lobby.ready` (`launchCommand`) and in the mutation **response** to the clicker (`data.lobby`).

On `lobby.launch`, each nick gets **one** push: members receive `lobby.launched`; queue watchers receive `lobby.update` `{ id, closed: true }` — not both, and not an extra `queue.update`.

## What the bot must listen for / send

1. **Listen** for `TAGMSG` aimed at the bot with tag `+gm`.
2. **Decode** base64url → JSON request.
3. **Authorize** — matchmaking is nick-based; NickServ is only needed when recording scores.
4. **Apply** queue/lobby mutations and persist state.
5. **Reply** to the requesting nick with `TAGMSG` + `+gm` (same `id`), either as one JSON payload or chunked envelopes.
6. **Push** `queue.update` / `lobby.update` / `lobby.ready` / `lobby.open` / `lobby.kicked` / `lobby.launched` / `start` as **private** TAGMSG to the affected nicks (no request `id`). Never to the salon.
7. The client does not TAGMSG the salon. On `queue.update` with `action: "joined"`, clients already in that queue show a local buffer line suggesting to talk to the new player.

Peer-to-peer game invites (`/<game> <nick>`) are handled by the game plugins. When the invite is accepted **and management is active**, the client sends `game.start` privately to the bot.

## Game results (client → bot)

When a match finishes normally and management is active, each participant may send **privately** to the bot:

```
TAGMSG gameMaster +gm=<base64url(JSON)>
```

```json
{
  "op": "game.result",
  "game": "chess",
  "players": ["Alice", "Bob"],
  "winner": "Alice"
}
```

- `winner` is `null` for a draw (or a Pictionary score tie).
- Interrupted / terminated games do not send `game.result`.
- Every participant may broadcast the same result; the bot must deduplicate and validate NickServ accounts.
