const WebSocket = require("ws");
const { TextEncoder } = require("util");

const MODE_URL = "https://drive.google.com/uc?export=download&id=1Igt8Zf9xJ8VonOygxPb6KMb2qVQ2TD6g";
const WS_URL = "wss://ip-207-148-8-148.cavegame.io";
const encoder = new TextEncoder();

let CURRENT_MODE = 1;
let TARGET_BOT_COUNT = 50;

let SERVER_ONLINE = true;
let PROBE_ACTIVE = false;

const HEARTBEAT_INTERVAL = 5000;
const TEAM_INTERVAL = 2000;
const INFINITE_INTERVAL = 7;
const MAX_BUFFER = 1024;

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
    for (let i = 0; i < bytes.length; i++) if (bytes[i] !== TEAM_JOINED_PACKET[i]) return false;
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

    amount = Math.min(amount, 500);
    return { mode, amount };
}

function startProbe() {
    if (PROBE_ACTIVE) return;
    PROBE_ACTIVE = true;

    const tryConnect = () => {
        if (bots.size >= TARGET_BOT_COUNT) {
            PROBE_ACTIVE = false;
            return;
        }

        const ws = new WebSocket(WS_URL);
        let resolved = false;

        ws.on("open", () => {
            resolved = true;
            SERVER_ONLINE = true;
            PROBE_ACTIVE = false;
            try { ws.terminate(); } catch {}
            ensureBotCount();
        });

        ws.on("error", () => { if (!resolved) try { ws.terminate(); } catch {} });
        ws.on("close", () => { if (!resolved) setTimeout(tryConnect, 10); });
    };

    SERVER_ONLINE = false;
    tryConnect();
}

function createBot() {
    const ws = new WebSocket(WS_URL);

    const bot = { ws, joined: false, destroyed: false, intervals: [], hbIndex: 0, lastInfinite: 0 };

    ws.on("open", () => {
        SERVER_ONLINE = true;

        safeSend(ws, Uint8Array.from([48]));
        safeSend(ws, buildIntroPacket());
        safeSend(ws, Uint8Array.from([49,33,47,116,101,97,109,32,99,114,101,97,116,101,32,84,101,115,116,101,114,115,32,103,51,56,57,56,101,110,97,107,108,49,48]));

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

    ws.on("close", () => reconnectBot(bot));
    ws.on("error", () => reconnectBot(bot));

    bots.add(bot);
}

function destroyBot(bot) {
    if (bot.destroyed) return;
    bot.destroyed = true;
    for (const i of bot.intervals) clearInterval(i);
    try { bot.ws.removeAllListeners(); bot.ws.terminate(); } catch {}
    bots.delete(bot);
}

function reconnectBot(bot) {
    destroyBot(bot);
    if (SERVER_ONLINE) startProbe();
}

function ensureBotCount() {
    if (!SERVER_ONLINE) return;

    while (bots.size < TARGET_BOT_COUNT) createBot();

    if (bots.size > TARGET_BOT_COUNT) {
        let excess = bots.size - TARGET_BOT_COUNT;
        for (const bot of bots) {
            if (excess-- <= 0) break;
            destroyBot(bot);
        }
    }
}

function applyModeToAllBots() {
    for (const bot of bots) {
        if (bot.destroyed) continue;
        destroyBot(bot);
    }
    ensureBotCount();
}

function applyConfig(newMode, newAmount) {
    const oldMode = CURRENT_MODE;
    const oldAmount = TARGET_BOT_COUNT;

    const modeChanged = newMode !== oldMode;
    const amountChanged = newAmount !== oldAmount;

    if (!modeChanged && !amountChanged) return;

    if (modeChanged) {
        console.log(`Mode: ${oldMode} -> ${newMode}`);
    }
    if (amountChanged) {
        console.log(`Target Amount: ${oldAmount} -> ${newAmount}`);
    }

    CURRENT_MODE = newMode;
    TARGET_BOT_COUNT = newAmount;

    if (modeChanged) applyModeToAllBots();

    ensureBotCount();
}

async function fetchInitialConfig() {
    try {
        const res = await fetch(MODE_URL + "&t=" + Date.now());
        const txt = await res.text();

        const { mode, amount } = parseConfig(txt);

        console.log(`Initial Mode: ${mode}`);
        console.log(`Initial Target Amount: ${amount}`);

        CURRENT_MODE = mode;
        TARGET_BOT_COUNT = amount;
    } catch (err) {
        console.error("Initial config error:", err);
    }
}

async function pollConfigFile() {
    try {
        const res = await fetch(MODE_URL + "&t=" + Date.now());
        const txt = await res.text();

        const { mode, amount } = parseConfig(txt);
        applyConfig(mode, amount);
    } catch (err) {
        console.error("Config fetch error:", err);
    }
}

async function init() {
    await fetchInitialConfig();
    ensureBotCount();
    setInterval(pollConfigFile, 3000);
    setInterval(ensureBotCount, 100);
}

init();

process.on("uncaughtException", () => {});
process.on("unhandledRejection", () => {});
