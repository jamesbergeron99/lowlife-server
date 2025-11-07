// server.js — Fixed version for gameCode + join-name logic
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
const server = http.createServer(app);

// --- CORS SETTINGS ---
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

// Store all active games
const games = {};

// --- SOCKET EVENTS ---
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // CREATE GAME
  socket.on("createGame", () => {
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    games[code] = {
      host: socket.id,
      players: [],
      numPlayers: 2
    };
    socket.join(code);
    console.log(`Game created: ${code}`);
    socket.emit("gameCreated", { code, isHost: true, numPlayers: 2 });
  });

  // UPDATE SETTINGS (host chooses # of players)
  socket.on("updateSettings", ({ code, numPlayers }) => {
    if (!games[code]) return;
    if (socket.id !== games[code].host) return;
    games[code].numPlayers = numPlayers;
    io.to(code).emit("settingsUpdate", numPlayers);
  });

  // JOIN GAME
  socket.on("joinGame", ({ code, name }) => {
    const game = games[code];
    if (!game) {
      socket.emit("errorMessage", "Game not found");
      return;
    }
    const player = { id: socket.id, name: name || "Player" };
    game.players.push(player);
    socket.join(code);
    console.log(`${name || "Player"} joined ${code}`);
    socket.emit("gameJoined", { code, isHost: false, numPlayers: game.numPlayers });
    io.to(code).emit("lobbyUpdate", game.players);
  });

  // START GAME
  socket.on("startGame", ({ code, names }) => {
    const game = games[code];
    if (!game) return;
    if (socket.id !== game.host) return;
    game.players = names.map((name, idx) => ({
      id: game.players[idx]?.id || `bot-${idx}`,
      name: name || `Player ${idx + 1}`,
      money: 0,
      position: 0
    }));
    game.current = 0;
    io.to(code).emit("gameStarted", game);
  });

  // PLAYER SPIN
  socket.on("playerSpin", ({ code }) => {
    const game = games[code];
    if (!game) return;
    const roll = Math.floor(Math.random() * 10) + 1;
    const player = game.players[game.current];
    player.position = Math.min(player.position + roll, 99);
    player.lastRoll = roll;
    io.to(code).emit("gameStateUpdate", game);
    game.current = (game.current + 1) % game.players.length;
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// --- FRIENDLY HOME ROUTE ---
app.get("/", (req, res) => {
  res.send("✅ LowLife game server is running and ready for connections!");
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
