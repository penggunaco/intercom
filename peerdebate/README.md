# 🎤 PeerDebate — Timed P2P Argument Arena

> **Intercom Vibe Competition Submission**
> Built on the Trac Systems / Intercom Ecosystem
> Author: trac13mnelajlq3zsjj6h408rywvwcqhsml26hht30ga2tlg3lnj64xtqejamqz

---

## What Is PeerDebate?

PeerDebate is a **fully decentralized, ephemeral debate platform** that runs over Hyperswarm P2P — no server, no database, no registration required.

A host opens a **debate room** with a topic and a countdown timer.
Peers join using a shared room code.
Anyone can submit arguments and upvote others' arguments.
When time runs out, the **most-upvoted argument wins** and the leaderboard is displayed to everyone.

Everything lives in memory. When the session ends, it's gone — perfectly ephemeral.

---

## ✨ Features

- 🔥 **Serverless** — Hyperswarm DHT handles peer discovery via holepunching
- ⏱️ **Live countdown** — host broadcasts ticks every second to all peers
- 💬 **Real-time arguments** — gossip protocol delivers new arguments instantly
- ▲ **Upvoting** — one vote per peer per argument, merged via eventual consistency
- 🏆 **Live leaderboard** — ASCII bar chart showing vote share live
- 🔐 **Noise-encrypted** — all Hyperswarm connections are end-to-end encrypted
- 📱 **Termux-ready** — works on Android with Node.js, no root required
- 🗑️ **Ephemeral** — zero data persisted to disk, ever

---

## 📋 Requirements

| Requirement | Minimum          |
|-------------|------------------|
| Node.js     | v18.0.0 or later |
| npm         | v8 or later      |
| OS          | Linux / macOS / Windows / Android (Termux) |
| Network     | Internet access (for DHT) |

---

## 🚀 Installation

### Standard (Linux / macOS / Windows)

```bash
# Clone the repo
git clone 
cd peerdebate

# Install dependencies
npm install

# Run
node index.js
```

### With Pear Runtime (Recommended for Trac/Intercom)

```bash
# Install Pear globally (once)
npm install -g pear

# Run PeerDebate via Pear
pear run .
```

---

## 📱 Termux Installation (Android)

Open Termux and type these commands one by one:

```bash
# 1. Update packages
pkg update && pkg upgrade -y

# 2. Install Node.js
pkg install nodejs -y

# 3. Install git
pkg install git -y

# 4. Clone the project
git clone
cd intercom-peerdebate

# 5. Install dependencies
npm install

# 6. Run!
node index.js
```

> 💡 **Tip:** You can also run two Termux sessions side by side using the Termux split-screen feature to test both host and guest roles on the same phone.

---

## 🎮 Usage Guide

When you start PeerDebate, you'll see the welcome banner and a command list.

### Starting a Debate (Host)

```
/host <room_code> <duration_minutes> <topic>
```

```
/host blockchain 5 Should Web3 replace Web2?
```

Share the `room_code` with your participants (via Intercom sidechannel, chat, etc.).

---

### Joining a Debate (Guest)

```
/join <room_code>
```

```
/join blockchain
```

PeerDebate automatically connects to the swarm, finds the host, and syncs the current state.

---

### Submitting an Argument

```
/argue <your argument text up to 280 characters>
```

```
/argue Web3 enables true ownership of digital assets without trusting corporations.
```

---

### Upvoting

```
/list          → see all arguments with their numbers
/up 2          → upvote argument #2
```

- One upvote per argument per peer
- You cannot upvote yourself

---

### Viewing Results

```
/score   → live leaderboard with bar chart
/list    → all arguments with vote counts
/peers   → connected peer count and your role
```

---

### Ending

When the timer reaches 00:00, the host broadcasts `debate_end`. All peers see:
- The winner's argument highlighted
- The full ranked leaderboard

Type `/exit` at any time to leave gracefully.

---

## 🗺️ Architecture

```
 ┌─────────────────────────────────────────────────────────────┐
 │                    Hyperswarm DHT                           │
 │   topic = SHA-256("peerdebate-v1:" + roomCode)              │
 └──────────────────────┬──────────────────────────────────────┘
                        │  encrypted Noise streams
          ┌─────────────┴──────────────┐
          │                            │
    ┌─────┴──────┐             ┌───────┴──────┐
    │    HOST    │             │    GUEST(s)  │
    │ Opens room │             │  /join room  │
    │ Runs timer │  gossip ──► │  /argue      │
    │ /argue     │ ◄── gossip  │  /up         │
    │ /up        │             │  /list       │
    └────────────┘             └──────────────┘

 Messages: debate_open | argument | upvote | tick | debate_end
           sync_req | sync_res
```

---

## 🔐 Security

- All connections encrypted via **Noise protocol** (built into Hyperswarm)
- Room topic is SHA-256 hashed — brute-forcing room names is expensive
- Peer IDs are ephemeral random bytes — no persistent identity
- No data ever written to disk

---

## 🗂️ File Structure

```
intercom-peerdebate/
├── index.js      ← Main app (Hyperswarm + CLI)
├── package.json  ← Dependencies
├── SKILL.md      ← Agent instructions (Intercom ecosystem)
└── README.md     ← This file
```

---

## 🔗 Relation to Intercom / Trac Ecosystem

PeerDebate is designed as an **Intercom agent** that:

1. Uses **Hyperswarm** (same DHT layer as the Intercom sidechannel)
2. Can receive room codes via the **Intercom sidechannel** for seamless UX
3. Can optionally record debate winners to the **Trac contract layer** for on-chain provenance
4. Follows the **Intercom agent** pattern defined in `SKILL.md`

---

## 📜 License

MIT — Free to fork, remix, and build upon.

---

Fork of: https://github.com/Trac-Systems/intercom

---

*PeerDebate — Because the best ideas should win, not the loudest voice.*
