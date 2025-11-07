// server.js — LowLife Server (Friendly Route + CORS Fixed)
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
    const gameCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    games[gameCode] = { players: [socket.id] };
    socket.join(gameCode);
    console.log(`Game created: ${gameCode}`);
    socket.emit("gameCreated", gameCode);
  });

  // JOIN GAME
  socket.on("joinGame", (code) => {
    if (games[code]) {
      games[code].players.push(socket.id);
      socket.join(code);
      console.log(`Player joined game ${code}`);
      io.to(code).emit("playerJoined", games[code].players.length);
    } else {
      socket.emit("errorMessage", "Game not found");
    }
  });

  // SAMPLE EVENT (you can expand later)
  socket.on("playerMove", (data) => {
    io.to(data.code).emit("updateGame", data);
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
