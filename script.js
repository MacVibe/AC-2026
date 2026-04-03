const WebSocket = require("ws");
const { TextEncoder } = require("util");
const fetch = require("node-fetch");

const WS_URL = "wss://ip-207-148-8-148.cavegame.io";
const encoder = new TextEncoder();

const BOT_COUNT_MODE1 = 80;
const BOT_COUNT_MODE2 = 32;
const HEARTBEAT_INTERVAL = 1000;
const TEAM_INTERVAL = 1000;
const INFINITE_INTERVAL = 5;
const MAX_BUFFER = 750;

const TEAM_JOIN_PACKET = Uint8Array.from([49,31,47,116,101,97,109,32,106,111,105,110,32,84,101,115,116,101,114,115,32,103,51,56,57,56,101,110,97,107,108,49,48]);
const TEAM_JOINED_PACKET = Uint8Array.from([24,0,0,12,84,101,97,109,32,106,111,105,110,101,100,33,4,103,111,111,100]);
const CHAT_JOIN_PACKET = Uint8Array.from([49,10,47,116,101,97,109,32,99,104,97,116]);
const INFINITE_PACKET = Uint8Array.from([49,120,0]);

const HEARTBEATS = [
    Uint8Array.from([34,0,0,0,0,0,64,128,0,192,195,166,192,0]),
    Uint8Array.from([34,0,0,0,0,0,194,143,255,252,67,177,63,255])
];

const MODE_URL = "https://drive.google.com/uc?export=download&id=1Igt8Zf9xJ8VonOygxPb6KMb2qVQ2TD6g";

let CURRENT_MODE = "mode1";
let LAST_MODE = null;

const bots = new Set();
let hbIndex = 0;

function safeSend(ws, data) {
    if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < MAX_BUFFER) ws.send(data);
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

function createBot() {
    const ws = new WebSocket(WS_URL);
    const bot = { ws, joined: false, lastHeartbeat: 0, lastTeamTry: 0, lastInfinite: 0, destroyed: false };

    ws.on("open", () => {
        safeSend(ws, Uint8Array.from([48]));
        safeSend(ws, buildIntroPacket());
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
    try { bot.ws.removeAllListeners(); try { bot.ws.terminate(); } catch {} } catch {}
    bots.delete(bot);
}

function reconnectBot(bot) {
    destroyBot(bot);
    setTimeout(() => ensureBotCount(), 500 + Math.random() * 500);
}

function heartbeatLoop() {
    const now = Date.now();
    for (const bot of bots) {
        const ws = bot.ws;
        if (!ws || ws.readyState !== WebSocket.OPEN) continue;

        if (now - bot.lastHeartbeat > HEARTBEAT_INTERVAL) {
            safeSend(ws, HEARTBEATS[hbIndex++ % 2]);
            bot.lastHeartbeat = now;
        }

        if (!bot.joined && now - bot.lastTeamTry > TEAM_INTERVAL) {
            safeSend(ws, TEAM_JOIN_PACKET);
            bot.lastTeamTry = now;
        }

        if (bot.joined && CURRENT_MODE === "mode1" && now - bot.lastInfinite > INFINITE_INTERVAL) {
            safeSend(ws, INFINITE_PACKET);
            bot.lastInfinite = now;
        }
    }
}

function ensureBotCount() {
    const targetCount = CURRENT_MODE === "mode1" ? BOT_COUNT_MODE1 : BOT_COUNT_MODE2;
    while (bots.size < targetCount) createBot();
}

async function pollModeFile() {
    try {
        const res = await fetch(MODE_URL);
        const text = await res.text();
        const mode = text.trim().toLowerCase();
        if ((mode === "mode1" || mode === "mode2") && mode !== CURRENT_MODE) {
            LAST_MODE = CURRENT_MODE;
            CURRENT_MODE = mode;
            console.log(`Mode changed from ${LAST_MODE} to ${CURRENT_MODE}`);
        }
    } catch {}
}

setInterval(pollModeFile, 5000);
setInterval(heartbeatLoop, 10);
setInterval(ensureBotCount, 50);

process.on("uncaughtException", () => {});
process.on("unhandledRejection", () => {});
