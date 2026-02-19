# SKILL.md — PeerDebate Agent

> **Intercom Vibe Competition Submission**
> Agent: `PeerDebate — Timed P2P Argument Arena`
> Author: trac13mnelajlq3zsjj6h408rywvwcqhsml26hht30ga2tlg3lnj64xtqejamqz

---

## What This Agent Does

PeerDebate is a decentralized, ephemeral debate platform running entirely on Hyperswarm P2P.
A host opens a "debate room" with a topic and a countdown timer.
Other peers join using the same room code.
Any peer can submit arguments and upvote others.
When the timer expires, the argument with the most upvotes wins.

No server. No database. No registration. Data is gone when the session ends.

---

## Runtime

| Requirement | Value                           |
|-------------|---------------------------------|
| Runtime     | Node.js ≥ 18 OR Pear Runtime    |
| Network     | Hyperswarm (DHT + holepunching) |
| Storage     | None (fully in-memory)          |
| Platform    | Linux, macOS, Windows, Termux   |

---

## Setup Steps (Agent / Human)

```bash
# 1. Install Node.js (or use Pear)
# 2. Clone or copy this project
cd intercom-peerdebate

# 3. Install dependencies
npm install

# 4. Run
node index.js
# OR with Pear:
pear run .
```

---

## How to Interact With This Agent

Once running, the agent presents a CLI. All commands begin with `/`.

### Opening a Debate (Host Role)

```
/host <room_code> <duration_minutes> <topic>
```

**Example:**
```
/host cryptowar 5 Is Bitcoin better than Ethereum?
```

- `room_code` — any short word, shared out-of-band with participants (e.g. via chat or Intercom sidechannel)
- `duration_minutes` — 1 to 60
- `topic` — the debate question (wrap in quotes if it has spaces, or just type it plainly)

The host's timer is authoritative. Ticks are broadcast to all peers every second.

---

### Joining a Debate (Guest Role)

```
/join <room_code>
```

**Example:**
```
/join cryptowar
```

The agent will connect to the Hyperswarm DHT, find the host and other peers, and sync the full current debate state automatically.

---

### Submitting an Argument

```
/argue <your argument text>
```

**Example:**
```
/argue Bitcoin has the strongest security model due to its proof-of-work history.
```

- Max 280 characters
- You can submit multiple arguments
- Arguments broadcast via gossip to all peers

---

### Upvoting an Argument

```
/up <argument_number>
```

**Example:**
```
/up 2
```

- Use `/list` first to see numbered arguments
- One upvote per peer per argument
- You cannot upvote your own arguments
- Upvotes broadcast instantly to all peers

---

### Viewing Arguments & Scores

```
/list    — lists all arguments in ranking order
/score   — shows the live bar-chart leaderboard with timer status
/peers   — shows connected peer count and your role (host/guest)
```

---

## Message Protocol (for Agent Interoperability)

Agents communicating over Hyperswarm send JSON messages on the shared topic stream:

| Message Type   | Fields                                  | Sent By   |
|----------------|-----------------------------------------|-----------|
| `debate_open`  | `debate` (full debate object)           | Host      |
| `argument`     | `arg` {id, text, author, ts, upvotes}   | Any peer  |
| `upvote`       | `argId`, `voter`                        | Any peer  |
| `tick`         | `secsLeft` (integer seconds)            | Host      |
| `debate_end`   | _(no fields)_                           | Host      |
| `sync_req`     | _(no fields)_                           | New peer  |
| `sync_res`     | `state` (debate object), `secsLeft`     | Host      |

Topic derivation:
```
topic = SHA-256("peerdebate-v1:" + roomCode)
```

An external agent can join any PeerDebate room by:
1. Deriving the topic with the formula above
2. Joining the Hyperswarm DHT on that topic
3. Sending `{ type: "sync_req" }` upon connection
4. Parsing the `sync_res` to get full state
5. Sending `{ type: "argument", arg: {...} }` to participate

---

## Consistency Model

- **Timer authority**: Host is source of truth for time. Non-hosts accept tick messages.
- **Votes**: Eventual consistency via gossip. Upvotes are merged as a Set (idempotent).
- **Arguments**: Merged by ID. New arguments gossip through all peers.
- **No fork resolution needed**: Debate sessions are short-lived and ephemeral.

---

## Intercom Sidechannel Integration

PeerDebate pairs naturally with the Intercom sidechannel:

1. Use the Intercom sidechannel to share the `room_code` and `topic` with your peers.
2. Participants open PeerDebate and `/join <room_code>`.
3. Use the Intercom contract layer to record the debate winner on-chain (optional).

---

## Security Notes

- All Hyperswarm connections use the Noise protocol (encrypted + authenticated).
- Peer IDs are ephemeral random hex strings — no persistent identity.
- No personally identifiable information is transmitted or stored.
- Room codes are hashed; room contents are visible to anyone who knows the code.

---

## Known Limitations

- If the host disconnects before the timer ends, the timer stops (guests see last tick).
- Large numbers of peers (>50) may cause redundant gossip — acceptable for competition use.
- No message signing; a malicious peer could spoof author IDs (out of scope for this demo).

---

*PeerDebate — Built for the Intercom Vibe Competition | Trac Systems Ecosystem*
