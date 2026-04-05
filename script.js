const WebSocket = require("ws");
const { TextEncoder } = require("util");

const WS_URL = "wss://ip-207-148-8-148.cavegame.io";
const encoder = new TextEncoder();

const BOT_COUNT_MODE1 = 80;
const BOT_COUNT_MODE2 = 32;

const HEARTBEAT_INTERVAL = 1000;
const TEAM_INTERVAL = 1000;
const INFINITE_INTERVAL = 5; // 🔥 restored

const MAX_BUFFER = 5000;

const TEAM_JOIN_PACKET = Uint8Array.from([49,31,47,116,101,97,109,32,106,111,105,110,32,84,101,115,116,101,114,115,32,103,51,56,57,56,101,110,97,107,108,49,48]);
const TEAM_JOINED_PACKET = Uint8Array.from([24,0,0,12,84,101,97,109,32,106,111,105,110,101,100,33,4,103,111,111,100]);
const CHAT_JOIN_PACKET = Uint8Array.from([49,10,47,116,101,97,109,32,99,104,97,116]);
const INFINITE_PACKET = Uint8Array.from([49,120,0]);

const HEARTBEATS = [
    Uint8Array.from([34,0,0,0,0,0,64,128,0,192,195,166,192,0]),
    Uint8Array.from([34,0,0,0,0,0,194,143,255,252,67,177,63,255])
];

let CURRENT_MODE = "mode1";
let hbIndex = 0;

const bots = new Set();

function safeSend(ws, data, force = false) {
    if (ws.readyState !== WebSocket.OPEN) return;

    // 🔑 Force heartbeats, throttle everything else
    if (force || ws.bufferedAmount < MAX_BUFFER) {
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

function createBot() {
    const ws = new WebSocket(WS_URL);

    const bot = {
        ws,
        joined: false,
        destroyed: false,
        intervals: [],
        lastInfinite: 0
    };

    ws.on("open", () => {
        safeSend(ws, Uint8Array.from([48]));
        safeSend(ws, buildIntroPacket());
        safeSend(ws, Uint8Array.from([49,33,47,116,101,97,109,32,99,114,101,97,116,101,32,84,101,115,116,101,114,115,32,103,51,56,57,56,101,110,97,107,108,49,48]));

        // ❤️ HEARTBEAT (never blocked)
        bot.intervals.push(setInterval(() => {
            safeSend(ws, HEARTBEATS[hbIndex++ % 2], true);
        }, HEARTBEAT_INTERVAL));

        // 👥 TEAM JOIN RETRY
        bot.intervals.push(setInterval(() => {
            if (!bot.joined) {
                safeSend(ws, TEAM_JOIN_PACKET);
            }
        }, TEAM_INTERVAL));

        // ♾️ FAST SPAM (with micro-throttle)
        bot.intervals.push(setInterval(() => {
            if (!bot.joined || CURRENT_MODE !== "mode1") return;

            const now = Date.now();

            // 🔑 Prevent total buffer lock
            if (now - bot.lastInfinite < INFINITE_INTERVAL) return;

            if (ws.bufferedAmount < MAX_BUFFER) {
                safeSend(ws, INFINITE_PACKET);
                bot.lastInfinite = now;
            }
        }, 1)); // run fast, but self-throttle
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

    try {
        bot.ws.removeAllListeners();
        bot.ws.terminate();
    } catch {}

    bots.delete(bot);
}

function reconnectBot(bot) {
    destroyBot(bot);

    // 🔁 ORIGINAL STYLE RANDOM DELAY
    setTimeout(() => {
        ensureBotCount();
    }, 500 + Math.random() * 500);
}

function ensureBotCount() {
    const target = CURRENT_MODE === "mode1" ? BOT_COUNT_MODE1 : BOT_COUNT_MODE2;

    while (bots.size < target) {
        createBot();
    }

    if (bots.size > target) {
        let excess = bots.size - target;
        for (const bot of bots) {
            if (excess-- <= 0) break;
            destroyBot(bot);
        }
    }
}

async function pollModeFile() {
    try {
        const res = await fetch("https://drive.google.com/uc?export=download&id=1Igt8Zf9xJ8VonOygxPb6KMb2qVQ2TD6g");
        const txt = await res.text();
        const mode = txt.trim().toLowerCase();

        if ((mode === "mode1" || mode === "mode2") && mode !== CURRENT_MODE) {
            console.log(`Mode changed: ${CURRENT_MODE} → ${mode}`);
            CURRENT_MODE = mode;
        }
    } catch {}
}

setInterval(pollModeFile, 3000);
setInterval(ensureBotCount, 500);

process.on("uncaughtException", () => {});
process.on("unhandledRejection", () => {});
