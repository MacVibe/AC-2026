const WebSocket = require("ws");
const { TextEncoder } = require("util");

const WS_URL = "wss://ip-207-148-8-148.cavegame.io";

const encoder = new TextEncoder();

function buildIntroPacket() {
    const name = encoder.encode(
        "\uD83D\uDD11" + Math.floor(Math.random() * 1000),
    );
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

function spawnBot() {
    const ws = new WebSocket(WS_URL);

    ws.on("open", () => {
        sendIntro(ws);

        let hbIdx = 0;
        ws._hb = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(HEARTBEATS[hbIdx++ % 2]);
            }
        }, 1000);
    });

    ws.on("close", () => {
        clearInterval(ws._hb);
        spawnBot();
    });

    ws.on("error", () => {
        ws.terminate();
    });
}

setInterval(spawnBot, 5);

// 👇 Fake HTTP server for Render
const http = require("http");

http.createServer((req, res) => {
    res.end("OK");
}).listen(process.env.PORT || 3000);
