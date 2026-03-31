const WebSocket = require("ws");
const { TextEncoder } = require("util");

const WS_URL = "wss://ip-207-148-8-148.cavegame.io";
const encoder = new TextEncoder();

const MAX_OPEN_BOTS = 85;
let openBots = 0;
let connectingBots = 0;
let queuedBots = 0;

const MAX_BUFFER = 2048;
const INFINITE_INTERVAL = 10; // high-speed packets

function safeSend(ws, data) {
    if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < MAX_BUFFER) {
        ws.send(data);
    }
}

function buildIntroPacket() {
    const name = encoder.encode("\uD83D\uDD11" + Math.floor(Math.random() * 1000));
    const packet = new Uint8Array(3 + name.length);
    packet[0] = 31;
    packet[1] = 1;
    packet[2] = 13;
    packet.set(name, 3);
    return packet;
}

const TEAM_JOIN_PACKET = Uint8Array.from([49,31,47,116,101,97,109,32,106,111,105,110,32,84,101,115,116,101,114,115,32,103,51,56,57,56,101,110,97,107,108,49,48]);
const TEAM_JOINED_PACKET = Uint8Array.from([24,0,0,12,84,101,97,109,32,106,111,105,110,101,100,33,4,103,111,111,100]);
const CHAT_JOIN_PACKET = Uint8Array.from([49,10,47,116,101,97,109,32,99,104,97,116]);
const INFINITE_PACKET = Uint8Array.from([49,120,0]);
const HEARTBEATS = [
    Uint8Array.from([34,0,0,0,0,0,64,128,0,192,195,166,192,0]),
    Uint8Array.from([34,0,0,0,0,0,194,143,255,252,67,177,63,255])
];

function isExactTeamJoined(data) {
    const bytes = new Uint8Array(data);
    if (bytes.length !== TEAM_JOINED_PACKET.length) return false;
    for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] !== TEAM_JOINED_PACKET[i]) return false;
    }
    return true;
}

function sendIntro(ws) {
    safeSend(ws, Uint8Array.from([48]));
    safeSend(ws, buildIntroPacket());
}

// Spawn instantly if slot available
function trySpawnBot() {
    if (openBots + connectingBots + queuedBots >= MAX_OPEN_BOTS) return;
    queuedBots++;
    spawnBot();
}

function spawnBot() {
    queuedBots--;
    const ws = new WebSocket(WS_URL);
    connectingBots++;

    let teamInterval = null;
    let infiniteInterval = null;
    let joined = false;

    ws.on("open", () => {
        connectingBots--;
        openBots++;
        sendIntro(ws);

        // Team join 1s interval
        teamInterval = setInterval(() => {
            if (!joined) safeSend(ws, TEAM_JOIN_PACKET);
        }, 1000);

        // Heartbeats 1s interval
        let hbIdx = 0;
        ws._hb = setInterval(() => {
            safeSend(ws, HEARTBEATS[hbIdx++ % 2]);
        }, 1000);
    });

    ws.on("message", (data) => {
        if (!joined && isExactTeamJoined(data)) {
            joined = true;
            clearInterval(teamInterval);
            safeSend(ws, CHAT_JOIN_PACKET);

            // Infinite packet loop
            infiniteInterval = setInterval(() => {
                safeSend(ws, INFINITE_PACKET);
            }, INFINITE_INTERVAL);
        }
    });

    function cleanup() {
        clearInterval(ws._hb);
        clearInterval(teamInterval);
        clearInterval(infiniteInterval);

        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.terminate();
        }

        if (openBots > 0) openBots--;
        if (connectingBots > 0) connectingBots--;

        // Spawn a new bot **immediately**
        trySpawnBot();
    }

    ws.on("close", cleanup);
    ws.on("error", cleanup);
}

// Spawn all bots instantly up to MAX_OPEN_BOTS
for (let i = 0; i < MAX_OPEN_BOTS; i++) {
    trySpawnBot();
}
