// server.js — Fixed Join + Start Game Logic (v3)
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  "https://jamesbergeron99.github.io",
  "https://jamesbergeron99.github.io/The-Game-Of-Lowlife-free/"
];

app.use(cors({
  origin: allowedOrigins,
  methods: ["GET", "POST"]
}));

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const games = {}; // all active games

io.on("connection", (socket) => {
  console.log("✅ User connected:", socket.id);

  // --- CREATE GAME ---
  socket.on("createGame", () => {
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    games[code] = {
      host: socket.id,
      players: [],
      started: false,
      numPlayers: 2
    };
    socket.join(code);
    console.log(`🎮 Game created: ${code}`);
    socket.emit("gameCreated", { code, isHost: true, numPlayers: 2 });
  });

  // --- UPDATE SETTINGS ---
  socket.on("updateSettings", ({ code, numPlayers }) => {
    const game = games[code];
    if (!game || socket.id !== game.host) return;
    game.numPlayers = numPlayers;
    io.to(code).emit("settingsUpdate", numPlayers);
  });

  // --- JOIN GAME ---
  socket.on("joinGame", ({ code, name }) => {
    const game = games[code];
    if (!game) {
      socket.emit("errorMessage", "Game not found");
      return;
    }
    if (game.started) {
      socket.emit("errorMessage", "Game already started");
      return;
    }
    const player = {
      id: socket.id,
      name: name || `Player${game.players.length + 1}`,
      money: 0,
      position: 0
    };
    game.players.push(player);
    socket.join(code);
    console.log(`👤 ${player.name} joined ${code}`);
    socket.emit("gameJoined", { code, isHost: socket.id === game.host, numPlayers: game.numPlayers });
    io.to(code).emit("lobbyUpdate", game.players);
  });

  // --- START GAME ---
  socket.on("startGame", ({ code }) => {
    const game = games[code];
    if (!game || socket.id !== game.host) return;
    if (game.players.length < 1) return;

    game.started = true;
    game.current = 0;

    // ensure everyone has a player object
    game.players = game.players.map((p, i) => ({
      ...p,
      id: p.id || `bot-${i}`,
      name: p.name || `Player ${i + 1}`,
      money: 0,
      position: 0,
      lastRoll: 0
    }));

    console.log(`🚀 Game ${code} started with ${game.players.length} players`);
    io.to(code).emit("gameStarted", game);
  });

  // --- PLAYER SPIN ---
  socket.on("playerSpin", ({ code }) => {
    const game = games[code];
    if (!game || !game.started) return;
    const player = game.players[game.current];
    if (!player) return;

    const roll = Math.floor(Math.random() * 10) + 1;
    player.position = Math.min(player.position + roll, 99);
    player.lastRoll = roll;

    // move to next player
    game.current = (game.current + 1) % game.players.length;
    console.log(`🎲 ${player.name} rolled ${roll} in ${code}`);
    io.to(code).emit("gameStateUpdate", game);
  });

  // --- DISCONNECT ---
  socket.on("disconnect", () => {
    console.log("❌ Disconnected:", socket.id);
    for (const code in games) {
      const game = games[code];
      game.players = game.players.filter((p) => p.id !== socket.id);
      io.to(code).emit("lobbyUpdate", game.players);
    }
  });
});

app.get("/", (req, res) => {
  res.send("✅ LowLife server online. Ready for Create + Join Game connections.");
});

server.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
