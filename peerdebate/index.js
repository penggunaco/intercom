/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║            PeerDebate — Timed P2P Argument Arena             ║
 * ║         Built for the Intercom Vibe Competition              ║
 * ║              Trac Systems / Intercom Ecosystem               ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  Architecture:                                               ║
 * ║  • Hyperswarm DHT for serverless peer discovery              ║
 * ║  • Room code → SHA-256 → 32-byte swarm topic                 ║
 * ║  • All state in-memory; data dies when session ends          ║
 * ║  • Gossip protocol: every peer re-broadcasts to others       ║
 * ║  • Host manages timer; non-hosts sync from host              ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  Message Types:                                              ║
 * ║  { type:'debate_open', debate }  — host opens debate         ║
 * ║  { type:'argument',    arg    }  — peer submits argument     ║
 * ║  { type:'upvote',      argId, voter } — peer upvotes         ║
 * ║  { type:'tick',        secsLeft }    — host broadcasts timer ║
 * ║  { type:'debate_end'  }              — host closes debate    ║
 * ║  { type:'sync_req'    }              — new peer asks state   ║
 * ║  { type:'sync_res',    state  }      — host sends full state ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import Hyperswarm from 'hyperswarm';
import crypto     from 'crypto';
import readline   from 'readline';

// ─── ANSI helpers ────────────────────────────────────────────────────────────
const A = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  cyan:    '\x1b[36m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  red:     '\x1b[31m',
  magenta: '\x1b[35m',
  blue:    '\x1b[34m',
  white:   '\x1b[97m',
  bBlue:   '\x1b[44m',
  bGreen:  '\x1b[42m',
};
const c = (color, str) => `${A[color]}${str}${A.reset}`;
const clearLine = () => process.stdout.write('\r\x1b[2K');

// ─── Identity ────────────────────────────────────────────────────────────────
const MY_ID = crypto.randomBytes(4).toString('hex');

// ─── State ───────────────────────────────────────────────────────────────────
let swarm      = null;
let peers      = new Set();        // active Hyperswarm connections
let isHost     = false;
let debate     = null;             // current DebateRoom object
let tickTimer  = null;             // setInterval handle (host only)
let secsLeft   = 0;

/**
 * DebateRoom shape:
 * {
 *   id:        string,        // 8-char hex
 *   topic:     string,        // the debate topic/question
 *   duration:  number,        // total seconds
 *   host:      string,        // peerId of creator
 *   startedAt: number,        // epoch ms
 *   open:      boolean,
 *   arguments: Map<string, Arg>
 * }
 *
 * Arg shape:
 * { id, text, author, ts, upvotes: Set<peerId> }
 */

// ─── Network helpers ─────────────────────────────────────────────────────────
function broadcast (msg, exclude = null) {
  const buf = Buffer.from(JSON.stringify(msg));
  for (const conn of peers) {
    if (conn !== exclude && !conn.destroyed) conn.write(buf);
  }
}

function sendTo (conn, msg) {
  if (!conn.destroyed) conn.write(Buffer.from(JSON.stringify(msg)));
}

function topicFromCode (roomCode) {
  return crypto.createHash('sha256').update('peerdebate-v1:' + roomCode).digest();
}

// ─── Serialise / Merge ───────────────────────────────────────────────────────
function serialiseDebate () {
  if (!debate) return null;
  const args = {};
  for (const [id, arg] of debate.arguments) {
    args[id] = { ...arg, upvotes: [...arg.upvotes] };
  }
  return {
    id:        debate.id,
    topic:     debate.topic,
    duration:  debate.duration,
    host:      debate.host,
    startedAt: debate.startedAt,
    open:      debate.open,
    arguments: args,
  };
}

function applySync (state) {
  if (!state) return;
  debate = {
    ...state,
    arguments: new Map(
      Object.entries(state.arguments || {}).map(([id, arg]) => [
        id,
        { ...arg, upvotes: new Set(arg.upvotes || []) },
      ])
    ),
  };
}

function mergeArg (arg) {
  if (!debate || !arg?.id) return false;
  const existing = debate.arguments.get(arg.id);
  if (!existing) {
    debate.arguments.set(arg.id, {
      ...arg,
      upvotes: new Set(arg.upvotes || []),
    });
    return true; // new
  }
  // merge upvotes
  for (const v of (arg.upvotes || [])) existing.upvotes.add(v);
  return false;
}

function mergeUpvote (argId, voter) {
  if (!debate) return false;
  const arg = debate.arguments.get(argId);
  if (!arg || arg.upvotes.has(voter)) return false;
  arg.upvotes.add(voter);
  return true;
}

// ─── Display ─────────────────────────────────────────────────────────────────
function banner () {
  console.log('');
  console.log(c('cyan', '╔══════════════════════════════════════════════════════╗'));
  console.log(c('cyan', '║') + c('bold', '    🎤  PeerDebate — Timed P2P Argument Arena     ') + c('cyan', '║'));
  console.log(c('cyan', '╚══════════════════════════════════════════════════════╝'));
  console.log(c('dim', `  Your Peer ID : ${MY_ID}`));
  console.log('');
}

function help () {
  console.log(c('yellow', '\n─── Commands ────────────────────────────────────────────'));
  console.log(c('white', '  /host  <room> <mins> <topic>') + '  — Create a debate room');
  console.log(c('white', '  /join  <room>') + '              — Join an existing room');
  console.log(c('white', '  /argue <text>') + '              — Submit your argument');
  console.log(c('white', '  /up    <arg#>') + '              — Upvote argument by number');
  console.log(c('white', '  /list') + '                      — Show all arguments');
  console.log(c('white', '  /score') + '                     — Show live leaderboard');
  console.log(c('white', '  /peers') + '                     — Show connected peers');
  console.log(c('white', '  /help') + '                      — This help text');
  console.log(c('white', '  /exit') + '                      — Quit PeerDebate');
  console.log(c('yellow', '─────────────────────────────────────────────────────────'));
  console.log(c('dim', '  Example: /host myroom 5 "Is Bitcoin better than gold?"'));
  console.log(c('dim', '  Example: /join myroom'));
  console.log('');
}

function fmtTime (secs) {
  const m = String(Math.floor(secs / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function sortedArgs () {
  if (!debate) return [];
  return [...debate.arguments.values()]
    .sort((a, b) => b.upvotes.size - a.upvotes.size || a.ts - b.ts);
}

function showList () {
  if (!debate) { console.log(c('dim', '\n  No active debate. Use /host or /join first.\n')); return; }
  const args = sortedArgs();
  if (args.length === 0) { console.log(c('dim', '\n  No arguments yet. Be the first — /argue <text>\n')); return; }
  console.log(c('yellow', `\n─── Arguments in "${debate.topic}" ─────────────────────`));
  args.forEach((arg, i) => {
    const votes = c('green', `▲ ${arg.upvotes.size}`);
    const you   = arg.author === MY_ID ? c('cyan', ' [you]') : '';
    const voted = arg.upvotes.has(MY_ID) ? c('dim', ' [voted]') : '';
    console.log(`  ${c('bold', `#${i + 1}`)} ${votes}${you}${voted} ${c('dim', arg.author + ' @' + new Date(arg.ts).toLocaleTimeString())}`);
    console.log(`     ${arg.text}`);
  });
  console.log('');
}

function showLeaderboard () {
  if (!debate) { console.log(c('dim', '\n  No active debate.\n')); return; }
  const args  = sortedArgs();
  const total = args.reduce((s, a) => s + a.upvotes.size, 0);
  const bar   = (v, t, w = 24) => {
    if (t === 0) return c('dim', '░'.repeat(w));
    const f = Math.round((v / t) * w);
    return c('green', '█'.repeat(f)) + c('dim', '░'.repeat(w - f));
  };
  const status = debate.open
    ? c('yellow', `⏱  ${fmtTime(secsLeft)} left`)
    : c('red', '🔴 CLOSED');
  console.log(c('yellow', `\n─── 🏆 Leaderboard  [${status}] ─────────────────────────`));
  if (args.length === 0) { console.log(c('dim', '  No arguments yet.\n')); return; }
  args.forEach((arg, i) => {
    const medal = ['🥇', '🥈', '🥉'][i] || '  ';
    const pct   = total ? Math.round((arg.upvotes.size / total) * 100) : 0;
    console.log(`  ${medal} ${bar(arg.upvotes.size, total)}  ${c('bold', arg.upvotes.size)} votes (${pct}%)`);
    console.log(`     ${c('dim', arg.text.slice(0, 72))}`);
  });
  console.log(c('dim', `  Total votes: ${total}  |  Arguments: ${args.length}`));
  console.log('');
}

function announceWinner () {
  const args = sortedArgs();
  console.log('');
  console.log(c('cyan', '╔══════════════════════════════════════════════════════╗'));
  console.log(c('cyan', '║') + c('bold', '              🏁  DEBATE CLOSED!                  ') + c('cyan', '║'));
  console.log(c('cyan', '╚══════════════════════════════════════════════════════╝'));
  if (args.length === 0) {
    console.log(c('dim', '  No arguments were submitted.\n'));
  } else {
    const w = args[0];
    console.log(c('yellow', `\n  🥇 Winner: ${w.author === MY_ID ? c('cyan', 'YOU!') : w.author}`));
    console.log(`  ${c('bold', `"${w.text}"`)} `);
    console.log(c('green', `  ▲ ${w.upvotes.size} vote${w.upvotes.size !== 1 ? 's' : ''}\n`));
    showLeaderboard();
  }
}

// ─── Ticker (Host only) ───────────────────────────────────────────────────────
function startTicker () {
  if (tickTimer) clearInterval(tickTimer);
  secsLeft = debate.duration;

  tickTimer = setInterval(() => {
    secsLeft--;
    broadcast({ type: 'tick', secsLeft });

    // Show countdown in-place every 10s or last 10s
    if (secsLeft % 10 === 0 || secsLeft <= 10) {
      clearLine();
      process.stdout.write(
        c('yellow', `  ⏱  ${fmtTime(secsLeft)} remaining in debate`) + '  '
      );
    }

    if (secsLeft <= 0) {
      clearInterval(tickTimer);
      tickTimer = null;
      debate.open = false;
      broadcast({ type: 'debate_end' });
      clearLine();
      announceWinner();
      promptUser();
    }
  }, 1000);
}

// ─── Message handler ─────────────────────────────────────────────────────────
function handleMsg (raw, fromConn) {
  let msg;
  try { msg = JSON.parse(raw.toString()); }
  catch { return; }

  switch (msg.type) {

    case 'debate_open': {
      if (debate) break; // already have one
      applySync(msg.debate);
      secsLeft = Math.max(0, debate.duration - Math.floor((Date.now() - debate.startedAt) / 1000));
      clearLine();
      console.log(c('magenta', `\n  📢 Debate opened by host ${debate.host}!`));
      console.log(c('bold', `  Topic: "${debate.topic}"`));
      console.log(c('dim', `  ⏱  ${fmtTime(secsLeft)} on the clock\n`));
      promptUser();
      // gossip
      broadcast(msg, fromConn);
      break;
    }

    case 'argument': {
      if (!debate || !debate.open) break;
      const isNew = mergeArg(msg.arg);
      if (isNew && msg.arg.author !== MY_ID) {
        clearLine();
        console.log(c('blue', `\n  💬 New argument from ${msg.arg.author}:`));
        console.log(`     ${msg.arg.text}\n`);
        promptUser();
      }
      broadcast(msg, fromConn);
      break;
    }

    case 'upvote': {
      if (!debate) break;
      const changed = mergeUpvote(msg.argId, msg.voter);
      if (changed && msg.voter !== MY_ID) {
        clearLine();
        const arg = debate.arguments.get(msg.argId);
        if (arg) {
          process.stdout.write(c('green', `  ▲ ${msg.voter} upvoted "${arg.text.slice(0, 40)}..."\n`));
          promptUser();
        }
      }
      broadcast(msg, fromConn);
      break;
    }

    case 'tick': {
      if (!isHost) secsLeft = msg.secsLeft;
      break;
    }

    case 'debate_end': {
      if (debate) debate.open = false;
      clearLine();
      announceWinner();
      promptUser();
      broadcast(msg, fromConn);
      break;
    }

    case 'sync_req': {
      // New peer asking for full state
      if (debate) {
        sendTo(fromConn, { type: 'sync_res', state: serialiseDebate(), secsLeft });
      }
      break;
    }

    case 'sync_res': {
      if (!debate && msg.state) {
        applySync(msg.state);
        secsLeft = msg.secsLeft ?? 0;
        clearLine();
        console.log(c('magenta', `\n  🔄 Synced from host.`));
        console.log(c('bold', `  Topic: "${debate.topic}"`));
        console.log(c('dim',  `  ⏱  ${fmtTime(secsLeft)} remaining  |  ${debate.arguments.size} argument(s) so far\n`));
        promptUser();
      }
      break;
    }

    default: break;
  }
}

// ─── Swarm setup ─────────────────────────────────────────────────────────────
async function joinSwarm (roomCode) {
  if (swarm) {
    await swarm.destroy();
    peers.clear();
  }

  swarm = new Hyperswarm();
  const topic = topicFromCode(roomCode);

  swarm.on('connection', (conn) => {
    peers.add(conn);
    connCount = peers.size;
    clearLine();
    console.log(c('green', `  🔗 Peer connected. Total peers: ${peers.size}\n`));
    promptUser();

    let buf = '';
    conn.on('data', (chunk) => {
      buf += chunk.toString();
      let idx;
      // Messages are newline-delimited OR we just parse each chunk as JSON
      // We'll parse each chunk as one JSON object (sent atomically via conn.write)
      try {
        const msg = JSON.parse(buf);
        buf = '';
        handleMsg(Buffer.from(JSON.stringify(msg)), conn);
      } catch {
        // incomplete chunk, keep buffering
      }
    });

    conn.on('close', () => {
      peers.delete(conn);
      clearLine();
      console.log(c('dim', `  ⚠  Peer disconnected. Remaining: ${peers.size}\n`));
      promptUser();
    });

    conn.on('error', () => { peers.delete(conn); });

    // New peer: ask for state if we don't have it
    if (!debate) {
      sendTo(conn, { type: 'sync_req' });
    }
    // Host: send state to joiner
    if (isHost && debate) {
      sendTo(conn, { type: 'sync_res', state: serialiseDebate(), secsLeft });
    }
  });

  await swarm.join(topic, { server: true, client: true });
  await swarm.flush();

  console.log(c('green', `\n  ✅ Joined swarm for room: ${c('bold', roomCode)}`));
  console.log(c('dim', `  Waiting for peers...\n`));
}

// ─── Commands ────────────────────────────────────────────────────────────────
async function cmdHost (parts) {
  // /host <roomCode> <minutes> <topic...>
  if (parts.length < 4) {
    console.log(c('red', '  Usage: /host <room> <minutes> <topic>'));
    console.log(c('dim', '  Example: /host myroom 5 Is P2P the future?'));
    return;
  }
  const roomCode = parts[1];
  const mins     = Math.max(1, Math.min(60, parseInt(parts[2], 10) || 5));
  const topic    = parts.slice(3).join(' ').replace(/^"|"$/g, '');

  if (!topic.trim()) { console.log(c('red', '  Topic cannot be empty.')); return; }

  isHost = true;
  debate = {
    id:        crypto.randomBytes(4).toString('hex'),
    topic,
    duration:  mins * 60,
    host:      MY_ID,
    startedAt: Date.now(),
    open:      true,
    arguments: new Map(),
  };
  secsLeft = debate.duration;

  await joinSwarm(roomCode);

  console.log(c('cyan', `\n  🎤 Debate room "${roomCode}" created!`));
  console.log(c('bold', `  Topic : "${topic}"`));
  console.log(c('yellow', `  Timer : ${mins} min(s)\n`));

  broadcast({ type: 'debate_open', debate: serialiseDebate() });
  startTicker();
}

async function cmdJoin (parts) {
  // /join <roomCode>
  if (parts.length < 2) { console.log(c('red', '  Usage: /join <room>')); return; }
  const roomCode = parts[1];
  isHost = false;
  await joinSwarm(roomCode);
  console.log(c('dim', '  Requesting debate state from host...\n'));
}

function cmdArgue (parts) {
  if (!debate) { console.log(c('red', '  Join a debate first: /join <room>')); return; }
  if (!debate.open) { console.log(c('red', '  Debate is closed. No more arguments.')); return; }

  const text = parts.slice(1).join(' ').trim();
  if (!text) { console.log(c('red', '  Argument cannot be empty.')); return; }
  if (text.length > 280) { console.log(c('red', '  Max 280 characters.')); return; }

  const arg = {
    id:     crypto.randomBytes(4).toString('hex'),
    text,
    author: MY_ID,
    ts:     Date.now(),
    upvotes: [],
  };

  mergeArg({ ...arg, upvotes: [] });
  broadcast({ type: 'argument', arg: { ...arg, upvotes: [] } });
  console.log(c('green', `\n  ✅ Argument submitted!\n`));
}

function cmdUpvote (parts) {
  if (!debate) { console.log(c('red', '  Join a debate first.')); return; }
  const num = parseInt(parts[1], 10);
  if (isNaN(num) || num < 1) { console.log(c('red', '  Usage: /up <arg#>  (use /list to see numbers)')); return; }

  const args   = sortedArgs();
  const target = args[num - 1];
  if (!target) { console.log(c('red', `  No argument #${num}. Use /list to see available.`)); return; }
  if (target.author === MY_ID) { console.log(c('red', '  You cannot upvote your own argument.')); return; }
  if (target.upvotes.has(MY_ID)) { console.log(c('yellow', '  You already upvoted this.')); return; }

  mergeUpvote(target.id, MY_ID);
  broadcast({ type: 'upvote', argId: target.id, voter: MY_ID });
  console.log(c('green', `\n  ▲ Upvoted: "${target.text.slice(0, 60)}"\n`));
}

function cmdPeers () {
  console.log(c('yellow', `\n  Connected peers: ${peers.size}`));
  console.log(c('dim', `  Your ID : ${MY_ID}  |  Role: ${isHost ? 'HOST' : 'Guest'}\n`));
}

// ─── CLI ─────────────────────────────────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function promptUser () {
  const label = debate
    ? c('cyan', `[${debate.topic.slice(0, 20)}${debate.topic.length > 20 ? '…' : ''}] `)
    : c('dim', '[no debate] ');
  rl.setPrompt(label + '> ');
  rl.prompt(true);
}

async function handleCommand (line) {
  const trimmed = line.trim();
  if (!trimmed) { promptUser(); return; }

  const parts = trimmed.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  const cmd   = parts[0]?.toLowerCase();

  switch (cmd) {
    case '/host':   await cmdHost(parts);   break;
    case '/join':   await cmdJoin(parts);   break;
    case '/argue':  cmdArgue(parts);        break;
    case '/up':     cmdUpvote(parts);       break;
    case '/list':   showList();             break;
    case '/score':  showLeaderboard();      break;
    case '/peers':  cmdPeers();             break;
    case '/help':   help();                 break;
    case '/exit':
      console.log(c('dim', '\n  Goodbye! 👋\n'));
      if (swarm) await swarm.destroy();
      process.exit(0);
      break;
    default:
      if (trimmed.startsWith('/')) {
        console.log(c('red', `  Unknown command: ${cmd}. Type /help for list.`));
      } else {
        console.log(c('dim', '  Commands start with /. Try /help'));
      }
  }

  promptUser();
}

// ─── Entry point ─────────────────────────────────────────────────────────────
async function main () {
  banner();
  help();
  promptUser();

  rl.on('line', async (line) => {
    await handleCommand(line);
  });

  rl.on('close', async () => {
    console.log(c('dim', '\n  Session ended.\n'));
    if (tickTimer) clearInterval(tickTimer);
    if (swarm) await swarm.destroy();
    process.exit(0);
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log(c('dim', '\n  Shutting down...\n'));
    if (tickTimer) clearInterval(tickTimer);
    if (swarm) await swarm.destroy();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(c('red', `  Fatal error: ${err.message}`));
  process.exit(1);
});
