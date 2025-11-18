const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let games = {};   // gameId → state
let sockets = {}; // socket → gameId

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

wss.on("connection", (ws) => {
  ws.on("message", (msg) => {
    let data;
    try {
      data = JSON.parse(msg);
    } catch (e) {
      return;
    }

    if (data.type === "create") {
      const id = generateCode();
      games[id] = {
        gameId: id,
        players: {},
        turn: null,
        state: "LOBBY",
        firstFinisherAwarded: false
      };
      sockets[ws] = id;
      ws.send(JSON.stringify({ type: "created", gameId: id }));
    }

    if (data.type === "join") {
      const id = data.gameId;
      if (!games[id]) {
        ws.send(JSON.stringify({ type: "error", message: "Game not found" }));
        return;
      }

      sockets[ws] = id;

      const pid = Math.random().toString(36).substring(2, 10);
      games[id].players[pid] = {
        id: pid,
        name: "Player " + (Object.keys(games[id].players).length + 1),
        position: 0,
        money: 0,
        family: 0,
        miss: false,
        color: ["#f44336", "#2196f3", "#4caf50", "#ff9800"][Object.keys(games[id].players).length % 4]
      };

      if (!games[id].turn) {
        games[id].turn = pid;
      }

      ws.send(JSON.stringify({ type: "joined", playerId: pid }));
      broadcast(id);
    }

    if (data.type === "start") {
      const id = sockets[ws];
      if (!games[id]) return;

      games[id].state = "PLAYING";
      broadcast(id);
    }

    if (data.type === "spin") {
      const id = sockets[ws];
      if (!games[id]) return;

      const roll = Math.floor(Math.random() * 10) + 1;
      const pid = data.playerId;
      const p = games[id].players[pid];

      p.position += roll;
      if (p.position >= 99) {
        if (!games[id].firstFinisherAwarded) {
          p.money += 5000;
          games[id].firstFinisherAwarded = true;
        }
        p.position = 99;
      }

      const order = Object.keys(games[id].players);
      const next = (order.indexOf(pid) + 1) % order.length;
      games[id].turn = order[next];

      broadcast(id);
    }
  });

  ws.on("close", () => {
    const id = sockets[ws];
    delete sockets[ws];
  });
});

function broadcast(gameId) {
  const msg = JSON.stringify({
    type: "state",
    state: games[gameId]
  });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && sockets[client] === gameId) {
      client.send(msg);
    }
  });
}

server.listen(process.env.PORT || 3000, () => {
  console.log("Server running.");
});
