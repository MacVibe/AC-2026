const WebSocket = require("ws");
const { TextEncoder } = require("util");

const MODE_URL = "https://drive.google.com/uc?export=download&id=1Igt8Zf9xJ8VonOygxPb6KMb2qVQ2TD6g";
const WS_URL = "wss://ip-207-148-8-148.cavegame.io";
const encoder = new TextEncoder();

let CURRENT_MODE = 1;
let TARGET_BOT_COUNT = 50;
let SERVER_ONLINE = true;

const HEARTBEAT_INTERVAL = 5000;
const TEAM_INTERVAL = 2000;

const MAX_BUFFER = 1024;
const KILL_BUFFER = MAX_BUFFER * 10;

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
    if (ws.readyState !== WebSocket.OPEN) return false;

    if (ws.bufferedAmount > KILL_BUFFER) {
        return "OVERFLOW";
    }

    if (!force && ws.bufferedAmount > MAX_BUFFER) {
        return false;
    }

    ws.send(data);
    return true;
}

function buildIntroPacket() {
    const name = encoder.encode("🔑	" + Math.floor(Math.random() * 10000));
    const packet = new Uint8Array(3 + name.length);
    packet[0] = 31;
    packet[1] = 1;
    packet[2] = 13;
    packet[3] = 194;
    packet[4] = 173;
    packet[5] = 13;
    packet.set(name, 6);
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

function clearBotIntervals(bot) {
    for (const i of bot.intervals) clearInterval(i);
    bot.intervals = [];
}

function destroyBot(bot) {
    if (bot.destroyed) return;
    bot.destroyed = true;

    clearBotIntervals(bot);

    try {
        bot.ws.removeAllListeners();
        bot.ws.terminate();
    } catch {}

    bots.delete(bot);
}

function attachBotHandlers(bot) {
    const ws = bot.ws;

    ws.on("open", () => {
        SERVER_ONLINE = true;
        clearBotIntervals(bot);

        safeSend(ws, Uint8Array.from([48]));
        safeSend(ws, buildIntroPacket());
        safeSend(ws, TEAM_CREATE_PACKET, true);

        bot.intervals.push(setInterval(() => {
            if (bot.destroyed) return;

            const packet = HEARTBEATS[bot.hbIndex % 2];
            bot.hbIndex++;

            const res = safeSend(ws, packet, true);
            if (res === "OVERFLOW") destroyBot(bot);

        }, HEARTBEAT_INTERVAL));

        const joinInterval = setInterval(() => {
            if (bot.destroyed) return;

            if (!bot.joined && ws.readyState === WebSocket.OPEN) {
                const res = safeSend(ws, TEAM_JOIN_PACKET, true);
                if (res === "OVERFLOW") destroyBot(bot);
            } else {
                clearInterval(joinInterval);
            }
        }, TEAM_INTERVAL);

        bot.intervals.push(joinInterval);

        const infInterval = setInterval(() => {
            if (bot.destroyed || !bot.joined) return;
            if (CURRENT_MODE !== 1) return;

            const res = safeSend(ws, INFINITE_PACKET);

            if (res === "OVERFLOW") {
                destroyBot(bot);
            }

        }, 7);

        bot.intervals.push(infInterval);
    });

    ws.on("message", (data) => {
        if (!bot.joined && isExactTeamJoined(data)) {
            bot.joined = true;
            safeSend(ws, CHAT_JOIN_PACKET, true);
        }
    });

    ws.on("close", () => destroyBot(bot));
    ws.on("error", () => destroyBot(bot));
}

function createBot() {
    const bot = {
        ws: new WebSocket(WS_URL),
        joined: false,
        destroyed: false,
        intervals: [],
        hbIndex: 0
    };

    attachBotHandlers(bot);
    bots.add(bot);
}

function ensureBotCount() {
    if (!SERVER_ONLINE) return;

    while (bots.size < TARGET_BOT_COUNT) createBot();

    if (bots.size > TARGET_BOT_COUNT) {
        let excess = bots.size - TARGET_BOT_COUNT;

        for (const bot of Array.from(bots)) {
            if (excess-- <= 0) break;
            destroyBot(bot);
        }
    }
}

function applyConfig(newMode, newAmount) {
    const modeChanged = newMode !== CURRENT_MODE;
    const amountChanged = newAmount !== TARGET_BOT_COUNT;

    if (!modeChanged && !amountChanged) return;

    CURRENT_MODE = newMode;
    TARGET_BOT_COUNT = newAmount;

    console.log(`Mode -> ${CURRENT_MODE}, Bots -> ${TARGET_BOT_COUNT}`);

    for (const bot of bots) {
        if (modeChanged) bot.joined = false;
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
    } catch (err) {
        console.error("Config fetch failed", err);
    }
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
    setInterval(ensureBotCount, 10);
}

init();

process.on("uncaughtException", () => {});
process.on("unhandledRejection", () => {});
