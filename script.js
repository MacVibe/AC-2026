const WebSocket = require("ws");
const { TextEncoder } = require("util");

const WS_URL = "wss://ip-207-148-8-148.cavegame.io";
const encoder = new TextEncoder();

const BOT_COUNT = 80;
const MAX_BUFFER = 2048;

const MAX_CONNECTING = 40; // HARD LIMIT (prevents memory spikes)

const HEARTBEATS = [
    Uint8Array.from([34,0,0,0,0,0,64,128,0,192,195,166,192,0]),
    Uint8Array.from([34,0,0,0,0,0,194,143,255,252,67,177,63,255])
];

const TEAM_JOIN_PACKET = Uint8Array.from([49,31,47,116,101,97,109,32,106,111,105,110,32,84,101,115,116,101,114,115,32,103,51,56,57,56,101,110,97,107,108,49,48]);
const TEAM_JOINED_PACKET = Uint8Array.from([24,0,0,12,84,101,97,109,32,106,111,105,110,101,100,33,4,103,111,111,100]);
const CHAT_JOIN_PACKET = Uint8Array.from([49,10,47,116,101,97,109,32,99,104,97,116]);
const INFINITE_PACKET = Uint8Array.from([49,120,0]);

const bots = new Set();

let hbIndex = 0;
let connecting = 0;

// ---------------- UTIL ----------------

function safeSend(ws, data) {
    if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < MAX_BUFFER) {
        ws.send(data);
    }
}

function buildIntroPacket() {
    const name = encoder.encode("🔑" + Math.floor(Math.random() * 10000));
    const packet = new Uint8Array(3 + name.length);
    packet[0] = 31;
    packet[1] = 1;
    packet[2] = 13;
    packet.set(name, 3);
    return packet;
}

function isExactTeamJoined(data) {
    const bytes = new Uint8Array(data);
    if (bytes.length !== TEAM_JOINED_PACKET.length) return false;
    for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] !== TEAM_JOINED_PACKET[i]) return false;
    }
    return true;
}

// ---------------- BOT ----------------

function createBot() {
    if (connecting >= MAX_CONNECTING) return;

    connecting++;

    const ws = new WebSocket(WS_URL, {
        perMessageDeflate: false
    });

    ws.joined = false;

    ws.on("open", () => {
        connecting--;

        try { ws._socket.setNoDelay(true); } catch {}

        safeSend(ws, Uint8Array.of(48));
        safeSend(ws, buildIntroPacket());
        safeSend(ws, TEAM_JOIN_PACKET);

        ensureBotCount(); // instantly fill more slots
    });

    ws.on("message", (data) => {
        if (!ws.joined && isExactTeamJoined(data)) {
            ws.joined = true;
            safeSend(ws, CHAT_JOIN_PACKET);
        }
    });

    ws.on("close", () => {
        connecting--;
        bots.delete(ws);
        try { ws.terminate(); } catch {}

        ensureBotCount(); // immediate retry (no delay)
    });

    ws.on("error", () => {
        connecting--;
        bots.delete(ws);
        try { ws.terminate(); } catch {}

        ensureBotCount(); // immediate retry (no delay)
    });

    bots.add(ws);
}

// ---------------- CONTROL ----------------

function ensureBotCount() {
    while (bots.size + connecting < BOT_COUNT && connecting < MAX_CONNECTING) {
        createBot();
    }
}

// ---------------- LOOPS ----------------

// fast global loop (lightweight)
setInterval(() => {
    const hb = HEARTBEATS[hbIndex++ % 2];

    for (const ws of bots) {
        if (ws.readyState !== WebSocket.OPEN) continue;

        safeSend(ws, hb);

        if (!ws.joined) {
            safeSend(ws, TEAM_JOIN_PACKET);
        } else {
            safeSend(ws, INFINITE_PACKET);
        }
    }
}, 5);

// continuously try to maintain count
setInterval(ensureBotCount, 50);

// ---------------- SAFETY ----------------

// hard memory guard
setInterval(() => {
    const mem = process.memoryUsage().rss / 1024 / 1024;

    if (mem > 480) {
        console.log("⚠️ Memory critical:", mem.toFixed(1), "MB");
        // temporarily stop new connections
        connecting = MAX_CONNECTING;
    }
}, 1000);

process.on("uncaughtException", () => {});
process.on("unhandledRejection", () => {});
