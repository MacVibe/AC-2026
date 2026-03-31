const WebSocket = require("ws");
const { TextEncoder, TextDecoder } = require("util");

const WS_URL = "wss://ip-207-148-8-148.cavegame.io";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function buildIntroPacket() {
    const name = encoder.encode("\uD83D\uDD11" + Math.floor(Math.random() * 1000));
    const packet = new Uint8Array(3 + name.length);
    packet[0] = 31;
    packet[1] = 1;
    packet[2] = 13;
    packet.set(name, 3);
    return packet;
}

function sendIntro(ws) {
    ws.send(Uint8Array.from([48]));
    ws.send(buildIntroPacket());
    ws.send(Uint8Array.from([49, 100, 47, 115, 112, 97, 119, 110]));
}

const HEARTBEATS = [
    Uint8Array.from([34, 0, 0, 0, 0, 0, 64, 128, 0, 192, 195, 166, 192, 0]),
    Uint8Array.from([34, 0, 0, 0, 0, 0, 194, 143, 255, 252, 67, 177, 63, 255]),
];

const TEAM_JOIN_PACKET = Uint8Array.from([49,31,47,116,101,97,109,32,106,111,105,110,32,84,101,115,116,101,114,115,32,103,51,56,57,56,101,110,97,107,108,49,48]);
const TEAM_CHAT_PACKET = Uint8Array.from([49,10,47,116,101,97,109,32,99,104,97,116]);
const CHAT_LOOP_PACKET = Uint8Array.from([49,120,0]);

function isTeamJoinedPacket(bytes) {
    try {
        return decoder.decode(bytes).includes("Team joined!");
    } catch {
        return false;
    }
}

function spawnBot() {
    const ws = new WebSocket(WS_URL);
    ws._joined = false;

    ws.on("open", () => {
        sendIntro(ws);
        setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) ws.send(TEAM_JOIN_PACKET);
        }, 500);
        let hbIdx = 0;
        ws._hb = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) ws.send(HEARTBEATS[hbIdx++ % 2]);
        }, 1000);
    });

    ws.on("message", (data) => {
        const bytes = new Uint8Array(data);
        if (!ws._joined && isTeamJoinedPacket(bytes)) {
            ws._joined = true;
            ws.send(TEAM_CHAT_PACKET);
            ws._chatLoop = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) ws.send(CHAT_LOOP_PACKET);
            }, 200);
        }
    });

    ws.on("close", () => {
        clearInterval(ws._hb);
        clearInterval(ws._chatLoop);
        spawnBot();
    });

    ws.on("error", () => ws.terminate());
}

setInterval(spawnBot, 5);
