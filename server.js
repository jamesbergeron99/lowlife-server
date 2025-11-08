// server.js
// Minimal Socket.IO server for "The Game of Lowlife"
// Run: 1) npm install  2) node server.js  (or use a host like Render/Railway/Replit)

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

const PORT = process.env.PORT || 3000;

// --- In-memory rooms ---
/*
room = {
  code: "ABCD",
  hostId: <socket.id>,
  started: false,
  firstFinisherAwarded: false,
  players: [{ sid, id, name }],
  // Random sources controlled by server:
  tardDeck: [...strings...],   // shuffled order (indexes match client deck text)
  tardPtr: 0
}
*/
const rooms = new Map();

// Utility
function makeCode() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return rooms.has(s) ? makeCode() : s;
}

// On connect
io.on("connection", (socket) => {
  // Create room
  socket.on("createRoom", (_, cb) => {
    const code = makeCode();
    rooms.set(code, {
      code,
      hostId: socket.id,
      started: false,
      firstFinisherAwarded: false,
      players: [],
      tardDeck: [], // client will send deck text once (stable)
      tardPtr: 0,
    });
    socket.join(code);
    cb && cb({ ok: true, code, isHost: true });
  });

  // Join room
  socket.on("joinRoom", ({ code, name, tardDeckSeed }, cb) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room) return cb && cb({ ok: false, error: "Room not found" });
    if (room.started) return cb && cb({ ok: false, error: "Game already started" });
    if (room.players.length >= 8) return cb && cb({ ok: false, error: "Room is full" });

    socket.join(room.code);
    const id = room.players.length + 1;
    room.players.push({ sid: socket.id, id, name: name?.trim() || `Player ${id}` });

    // If tard deck not initialized, accept client seed (the full ordered list).
    if (!room.tardDeck?.length && Array.isArray(tardDeckSeed) && tardDeckSeed.length >= 10) {
      // Simple shuffle that both sides can accept as "server chosen":
      room.tardDeck = [...tardDeckSeed].sort(() => Math.random() - 0.5);
      room.tardPtr = 0;
    }

    io.to(room.code).emit("lobbyUpdate", {
      players: room.players.map((p) => ({ id: p.id, name: p.name })),
      hostId: room.hostId,
      code: room.code,
    });
    cb && cb({ ok: true, id, isHost: socket.id === room.hostId });
  });

  // Start game (host only). Server just flags started; clients build identical initial state.
  socket.on("startGame", ({ code }, cb) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room) return cb && cb({ ok: false, error: "Room not found" });
    if (socket.id !== room.hostId) return cb && cb({ ok: false, error: "Only host can start" });
    if (room.players.length < 2) return cb && cb({ ok: false, error: "Need at least 2 players" });

    room.started = true;
    room.firstFinisherAwarded = false;
    io.to(room.code).emit("gameStarted", {
      players: room.players.map((p) => ({ id: p.id, name: p.name })),
      tardDeck: room.tardDeck,
    });
    cb && cb({ ok: true });
  });

  // Authoritative random: movement spin
  socket.on("requestMoveSpin", ({ code, playerId }, cb) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room || !room.started) return cb && cb({ ok: false });
    const roll = Math.floor(Math.random() * 10) + 1;
    io.to(room.code).emit("serverMoveSpin", { playerId, roll });
    cb && cb({ ok: true, roll });
  });

  // Authoritative random: extra spin (extortion/payoff/other ×multiplier)
  socket.on("requestExtraSpin", ({ code, playerId, multiplier }, cb) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room || !room.started) return cb && cb({ ok: false });
    const roll = Math.floor(Math.random() * 10) + 1;
    const amount = roll * (Number(multiplier) || 1);
    io.to(room.code).emit("serverExtraSpin", { playerId, roll, amount, multiplier });
    cb && cb({ ok: true, roll, amount });
  });

  // Authoritative random: bankruptcy rescue
  socket.on("requestRescueSpin", ({ code, playerId }, cb) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room || !room.started) return cb && cb({ ok: false });
    const roll = Math.floor(Math.random() * 10) + 1;
    io.to(room.code).emit("serverRescueSpin", { playerId, roll });
    cb && cb({ ok: true, roll });
  });

  // Authoritative random: TARD draw
  socket.on("requestTardDraw", ({ code, playerId }, cb) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room || !room.started) return cb && cb({ ok: false });
    if (!room.tardDeck?.length) return cb && cb({ ok: false, error: "No deck" });

    if (room.tardPtr >= room.tardDeck.length) {
      // reshuffle
      room.tardDeck = [...room.tardDeck].sort(() => Math.random() - 0.5);
      room.tardPtr = 0;
    }
    const card = room.tardDeck[room.tardPtr++];
    io.to(room.code).emit("serverTardDraw", { playerId, card, remaining: room.tardDeck.length - room.tardPtr });
    cb && cb({ ok: true, card, remaining: room.tardDeck.length - room.tardPtr });
  });

  // Finish bonus claim (first come first served)
  socket.on("claimFinishBonus", ({ code, playerId }, cb) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room || !room.started) return cb && cb({ ok: false });
    if (room.firstFinisherAwarded) return cb && cb({ ok: false, already: true });
    room.firstFinisherAwarded = true;
    io.to(room.code).emit("finishBonusAwarded", { playerId, amount: 5000 });
    cb && cb({ ok: true, amount: 5000 });
  });

  // Disconnection cleanup
  socket.on("disconnect", () => {
    // Remove from any rooms
    for (const [code, room] of rooms) {
      const before = room.players.length;
      room.players = room.players.filter((p) => p.sid !== socket.id);
      if (before !== room.players.length) {
        // Announce lobby update
        io.to(code).emit("lobbyUpdate", {
          players: room.players.map((p) => ({ id: p.id, name: p.name })),
          hostId: room.hostId,
          code: room.code,
        });
      }
      // If host left and room not started, promote first player (if any)
      if (!room.started && room.players.length && room.hostId === socket.id) {
        room.hostId = room.players[0].sid;
        io.to(code).emit("lobbyUpdate", {
          players: room.players.map((p) => ({ id: p.id, name: p.name })),
          hostId: room.hostId,
          code: room.code,
        });
      }
      // If room empty, delete
      if (!room.players.length) rooms.delete(code);
    }
  });
});

server.listen(PORT, () => console.log(`Lowlife server running on :${PORT}`));
