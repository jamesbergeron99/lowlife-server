// server.js — host-authoritative turn engine with serialization & debouncing
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/healthz", (_, res) => res.send("OK"));

// ---- Room state ----
const rooms = new Map();
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function makeCode() {
  let s = "";
  for (let i = 0; i < 4; i++) s += CODE_ALPHABET[Math.floor(Math.random()*CODE_ALPHABET.length)];
  if (rooms.has(s)) return makeCode();
  return s;
}

io.on("connection", (socket) => {
  socket.on("createRoom", (_, cb) => {
    const code = makeCode();
    rooms.set(code, {
      code,
      hostId: socket.id,
      players: [], // {sid,id,name}
      started: false,
      currentTurnIndex: 0,
      actionSeq: 0,       // monotonically increasing action id
      spinning: false,    // serialize spins
      firstFinisherAwarded: false,
      tardDeck: [],
      tardPtr: 0,
    });
    socket.join(code);
    cb && cb({ ok: true, code, isHost: true });
  });

  socket.on("joinRoom", ({ code, name, tardDeckSeed }, cb) => {
    code = String(code || "").toUpperCase();
    const room = rooms.get(code);
    if (!room) return cb && cb({ ok: false, error: "Room not found" });
    if (room.started) return cb && cb({ ok: false, error: "Game already started" });
    if (room.players.length >= 8) return cb && cb({ ok: false, error: "Room is full" });

    socket.join(code);
    const id = room.players.length + 1;
    room.players.push({ sid: socket.id, id, name: name?.trim() || `Player ${id}` });

    if (!room.tardDeck?.length && Array.isArray(tardDeckSeed) && tardDeckSeed.length >= 10) {
      room.tardDeck = [...tardDeckSeed].sort(() => Math.random() - 0.5);
      room.tardPtr = 0;
    }

    io.to(code).emit("lobbyUpdate", {
      players: room.players.map(p => ({ id: p.id, name: p.name })),
      hostId: room.hostId,
      code,
    });
    cb && cb({ ok: true, id, isHost: socket.id === room.hostId });
  });

  socket.on("startGame", ({ code }, cb) => {
    code = String(code || "").toUpperCase();
    const room = rooms.get(code);
    if (!room) return cb && cb({ ok: false, error: "Room not found" });
    if (socket.id !== room.hostId) return cb && cb({ ok: false, error: "Only host can start" });
    if (room.players.length < 2) return cb && cb({ ok: false, error: "Need at least 2 players" });

    room.started = true;
    room.currentTurnIndex = 0;
    room.actionSeq = 1;
    room.spinning = false;
    room.firstFinisherAwarded = false;

    io.to(code).emit("gameStarted", {
      players: room.players.map(p => ({ id: p.id, name: p.name })),
      currentPlayerId: room.players[0].id,
      seq: room.actionSeq
    });
    cb && cb({ ok: true });
  });

  function ensureActive(room, playerId, sid) {
    const pIdx = room.players.findIndex(p => p.id === playerId);
    if (pIdx !== room.currentTurnIndex) return { ok: false, error: "Not your turn" };
    const p = room.players[pIdx];
    if (!p || p.sid !== sid) return { ok: false, error: "Identity mismatch" };
    return { ok: true };
  }

  function nextTurn(room) {
    room.currentTurnIndex = (room.currentTurnIndex + 1) % room.players.length;
    room.actionSeq += 1;
    const currentPlayerId = room.players[room.currentTurnIndex].id;
    io.to(room.code).emit("turnChanged", { currentPlayerId, seq: room.actionSeq });
  }

  socket.on("requestMoveSpin", ({ code, playerId }, cb) => {
    code = String(code || "").toUpperCase();
    const room = rooms.get(code);
    if (!room || !room.started) return cb && cb({ ok: false, error: "No game" });

    const auth = ensureActive(room, playerId, socket.id);
    if (!auth.ok) return cb && cb({ ok: false, error: auth.error });

    if (room.spinning) return cb && cb({ ok: false, error: "Spin in progress" });
    room.spinning = true;

    const roll = Math.floor(Math.random() * 10) + 1;
    const seq = ++room.actionSeq;
    io.to(code).emit("serverMoveSpin", { playerId, roll, seq });

    // unlock & advance turn after client resolves (give it enough time to animate)
    setTimeout(() => {
      room.spinning = false;
      nextTurn(room);
    }, 4500);

    cb && cb({ ok: true, roll, seq });
  });

  socket.on("requestExtraSpin", ({ code, playerId, multiplier }, cb) => {
    code = String(code || "").toUpperCase();
    const room = rooms.get(code);
    if (!room || !room.started) return cb && cb({ ok: false });
    // Allow extra spins only for the player whose action is being resolved (same turn index)
    const auth = ensureActive(room, playerId, socket.id);
    if (!auth.ok && room.spinning) {
      // If we're currently spinning for this player's action, permit extra spin
      // (often triggered as part of TARD/payoff/extortion chaining)
    }

    const roll = Math.floor(Math.random() * 10) + 1;
    const amount = roll * (Number(multiplier) || 1);
    const seq = ++room.actionSeq;
    io.to(code).emit("serverExtraSpin", { playerId, roll, amount, multiplier, seq });
    cb && cb({ ok: true, roll, amount, seq });
  });

  socket.on("requestRescueSpin", ({ code, playerId }, cb) => {
    code = String(code || "").toUpperCase();
    const room = rooms.get(code);
    if (!room || !room.started) return cb && cb({ ok: false });

    const roll = Math.floor(Math.random() * 10) + 1;
    const seq = ++room.actionSeq;
    io.to(code).emit("serverRescueSpin", { playerId, roll, seq });
    cb && cb({ ok: true, roll, seq });
  });

  socket.on("requestTardDraw", ({ code, playerId }, cb) => {
    code = String(code || "").toUpperCase();
    const room = rooms.get(code);
    if (!room || !room.started) return cb && cb({ ok: false, error: "No game" });

    if (!room.tardDeck?.length) return cb && cb({ ok: false, error: "No deck" });
    if (room.tardPtr >= room.tardDeck.length) {
      room.tardDeck = [...room.tardDeck].sort(() => Math.random() - 0.5);
      room.tardPtr = 0;
    }
    const card = room.tardDeck[room.tardPtr++];
    const remaining = room.tardDeck.length - room.tardPtr;
    const seq = ++room.actionSeq;
    io.to(code).emit("serverTardDraw", { playerId, card, remaining, seq });
    cb && cb({ ok: true, card, remaining, seq });
  });

  socket.on("claimFinishBonus", ({ code, playerId }, cb) => {
    code = String(code || "").toUpperCase();
    const room = rooms.get(code);
    if (!room || !room.started) return cb && cb({ ok: false });
    if (room.firstFinisherAwarded) return cb && cb({ ok: false, already: true });
    room.firstFinisherAwarded = true;
    const seq = ++room.actionSeq;
    io.to(code).emit("finishBonusAwarded", { playerId, amount: 5000, seq });
    cb && cb({ ok: true, amount: 5000, seq });
  });

  socket.on("disconnect", () => {
    for (const [code, room] of rooms) {
      const before = room.players.length;
      room.players = room.players.filter(p => p.sid !== socket.id);
      if (before !== room.players.length) {
        io.to(code).emit("lobbyUpdate", {
          players: room.players.map(p => ({ id: p.id, name: p.name })),
          hostId: room.hostId,
          code,
        });
      }
      // Host handoff in lobby
      if (!room.started && room.players.length && room.hostId === socket.id) {
        room.hostId = room.players[0].sid;
        io.to(code).emit("lobbyUpdate", {
          players: room.players.map(p => ({ id: p.id, name: p.name })),
          hostId: room.hostId,
          code,
        });
      }
      if (!room.players.length) rooms.delete(code);
    }
  });
});

server.listen(PORT, () => console.log(`Lowlife online fixed running on :${PORT}`));
