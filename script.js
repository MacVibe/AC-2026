const WebSocket = require("ws");
const { TextEncoder } = require("util");

const WS_URL = "wss://ip-207-148-8-148.cavegame.io";
const encoder = new TextEncoder();

const HARD_MAX_BOTS = 85;
let TARGET_BOTS = 85;
const TICK_RATE = 20;
const MAX_SPAWN_PER_TICK = 20;

const HEARTBEAT_INTERVAL = 1000;
const TEAM_INTERVAL = 1000;
const INFINITE_INTERVAL = 10;

const MAX_BUFFER = 512;
const BUFFER_KILL = 512;

const RAM_HIGH = 300;
const RAM_CRITICAL = 500;

const TEAM_JOIN_PACKET = Uint8Array.from([49,31,47,116,101,97,109,32,106,111,105,110,32,84,101,115,116,101,114,115,32,103,51,56,57,56,101,110,97,107,108,49,48]);
const TEAM_JOINED_PACKET = Uint8Array.from([24,0,0,12,84,101,97,109,32,106,111,105,110,101,100,33,4,103,111,111,100]);
const CHAT_JOIN_PACKET = Uint8Array.from([49,10,47,116,101,97,109,32,99,104,97,116]);
const INFINITE_PACKET = Uint8Array.from([49,120,0]);

const HEARTBEATS = [
    Uint8Array.from([34,0,0,0,0,0,64,128,0,192,195,166,192,0]),
    Uint8Array.from([34,0,0,0,0,0,194,143,255,252,67,177,63,255])
];

const bots = new Set();
const botQueue = [];

let hbIndex = 0;
let failureScore = 0;

function safeSend(ws, data) {
    if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < MAX_BUFFER) {
        ws.send(data);
    }
}

function buildIntroPacket() {
    const name = encoder.encode("🔑" + Math.floor(Math.random() * 1000));
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

function getMemoryUsageMB() {
    const mem = process.memoryUsage();
    return {
        rss: mem.rss / 1024 / 1024,
        heapUsed: mem.heapUsed / 1024 / 1024
    };
}

function createBot() {
    const ws = new WebSocket(WS_URL);
    const bot = {
        ws,
        joined: false,
        lastHeartbeat: 0,
        lastTeamTry: 0,
        lastInfinite: 0
    };
    ws.on("open", () => {
        safeSend(ws, Uint8Array.from([48]));
        safeSend(ws, buildIntroPacket());
        failureScore = Math.max(0, failureScore - 2);
    });
    ws.on("message", (data) => {
        if (!bot.joined && isExactTeamJoined(data)) {
            bot.joined = true;
            safeSend(ws, CHAT_JOIN_PACKET);
        }
    });
    ws.on("close", () => destroyBot(bot));
    ws.on("error", () => destroyBot(bot));
    bots.add(bot);
}

function destroyBot(bot) {
    if (!bots.has(bot)) return;
    bots.delete(bot);
    failureScore++;
    try {
        bot.ws.removeAllListeners();
        bot.ws.terminate();
    } catch {}
    bot.ws = null;
    botQueue.push(Date.now() + 50);
}

setInterval(() => {
    const now = Date.now();
    let spawned = 0;
    while (spawned < MAX_SPAWN_PER_TICK && bots.size < TARGET_BOTS && botQueue.length > 0 && botQueue[0] <= now) {
        botQueue.shift();
        createBot();
        spawned++;
    }
    while (spawned < MAX_SPAWN_PER_TICK && bots.size < TARGET_BOTS) {
        createBot();
        spawned++;
    }
    for (const bot of bots) {
        const ws = bot.ws;
        if (!ws) continue;
        if (ws.bufferedAmount > BUFFER_KILL) {
            destroyBot(bot);
            continue;
        }
        if (ws.readyState !== WebSocket.OPEN) continue;
        if (now - bot.lastHeartbeat > HEARTBEAT_INTERVAL) {
            safeSend(ws, HEARTBEATS[hbIndex++ % 2]);
            bot.lastHeartbeat = now;
        }
        if (!bot.joined && now - bot.lastTeamTry > TEAM_INTERVAL) {
            safeSend(ws, TEAM_JOIN_PACKET);
            bot.lastTeamTry = now;
        }
        if (bot.joined && now - bot.lastInfinite > INFINITE_INTERVAL) {
            safeSend(ws, INFINITE_PACKET);
            bot.lastInfinite = now;
        }
    }
    if (bots.size > TARGET_BOTS) {
        let excess = bots.size - TARGET_BOTS;
        for (const bot of bots) {
            destroyBot(bot);
            if (--excess <= 0) break;
        }
    }
}, TICK_RATE);

setInterval(() => {
    const mem = getMemoryUsageMB();
    if (mem.rss > RAM_CRITICAL) {
        TARGET_BOTS = Math.max(5, Math.floor(TARGET_BOTS * 0.5));
    } else if (mem.rss > RAM_HIGH) {
        TARGET_BOTS = Math.max(10, TARGET_BOTS - 5);
    } else if (mem.rss < RAM_HIGH * 0.7) {
        TARGET_BOTS = Math.min(HARD_MAX_BOTS, TARGET_BOTS + 2);
    }
    if (failureScore > 50) {
        TARGET_BOTS = Math.max(5, TARGET_BOTS - 10);
    }
    console.log(
        `RAM: ${mem.rss.toFixed(1)}MB | Bots: ${bots.size}/${TARGET_BOTS} | Queue: ${botQueue.length} | Fail: ${failureScore}`
    );
}, 10000);
