// server.js

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

// ----- Basic Express setup -----
const app = express();

// Allow JSON if you ever add REST endpoints
app.use(express.json());

// CORS for any origin (we can tighten this later if you want)
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
  })
);

// Simple health check (so hitting the root URL doesn't 404)
app.get("/", (req, res) => {
  res.send("LowLife server is running.");
});

// ----- Create HTTP + Socket.IO server -----
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*", // IMPORTANT: this avoids the Access-Control-Allow-Origin mismatch
    methods: ["GET", "POST"],
  },
});

// In-memory game store
// games[code] = { code, hostId, players: [{ id, name }], started: false }
const games = {};

// Utility to generate a 5-character game code (e.g., AB3D9)
function generateGameCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // avoid confusing chars
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// Make sure code is unique (for this server instance)
function createUniqueCode() {
  let code;
  do {
    code = generateGameCode();
  } while (games[code]);
  return code;
}

// ----- Socket.IO logic -----
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Host creates a game
  socket.on("createGame", (payload) => {
    try {
      const code = createUniqueCode();

      games[code] = {
        code,
        hostId: socket.id,
        players: [],
        started: false,
      };

      socket.join(code);

      console.log(`Game created: ${code} by host ${socket.id}`);

      // Send code back to the creator
      // (Your client should listen for either "gameCreated" or "gameCode")
      socket.emit("gameCreated", { code });
      socket.emit("gameCode", { code });
    } catch (err) {
      console.error("Error in createGame:", err);
      socket.emit("errorMessage", { message: "Failed to create game." });
    }
  });

  // Player joins an existing game by code
  socket.on("joinGame", ({ code, name }) => {
    try {
      if (!code) {
        socket.emit("joinError", { message: "No game code provided." });
        return;
      }

      const upperCode = code.toUpperCase();
      const game = games[upperCode];

      if (!game) {
        socket.emit("joinError", { message: "Game not found." });
        return;
      }

      socket.join(upperCode);

      const playerName = name && name.trim() ? name.trim() : "Player";
      const player = { id: socket.id, name: playerName };

      // Only add once
      if (!game.players.find((p) => p.id === socket.id)) {
        game.players.push(player);
      }

      console.log(`Player joined game ${upperCode}:`, playerName);

      // Notify everyone in the room about the updated lobby
      io.to(upperCode).emit("lobbyUpdate", {
        code: upperCode,
        players: game.players,
      });

      // Acknowledge to the joining player
      socket.emit("joinedGame", {
        code: upperCode,
        player,
      });
    } catch (err) {
      console.error("Error in joinGame:", err);
      socket.emit("joinError", { message: "Failed to join game." });
    }
  });

  // Host starts the game
  socket.on("startGame", ({ code }) => {
    try {
      if (!code) return;

      const upperCode = code.toUpperCase();
      const game = games[upperCode];

      if (!game) return;
      if (game.hostId !== socket.id) {
        console.log("Non-host tried to start game", socket.id);
        return;
      }

      game.started = true;

      console.log(`Game started: ${upperCode}`);

      // Tell all clients in this game that the game has started.
      // Your client can listen for "gameStarted" to show the board.
      io.to(upperCode).emit("gameStarted", {
        code: upperCode,
        players: game.players,
        currentTurnIndex: 0,
      });
    } catch (err) {
      console.error("Error in startGame:", err);
      socket.emit("errorMessage", { message: "Failed to start game." });
    }
  });

  // Optional: a basic handler for spin events if you wire it later
  socket.on("spin", ({ code, roll, playerId }) => {
    try {
      if (!code) return;
      const upperCode = code.toUpperCase();
      const game = games[upperCode];
      if (!game || !game.started) return;

      // Just broadcast the spin result to everyone in the room.
      // Your front end already handles moving pieces and TTS.
      io.to(upperCode).emit("spinResult", {
        code: upperCode,
        roll,
        playerId,
      });
    } catch (err) {
      console.error("Error in spin:", err);
    }
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);

    // Remove from any games they were in
    for (const code of Object.keys(games)) {
      const game = games[code];
      const before = game.players.length;
      game.players = game.players.filter((p) => p.id !== socket.id);

      // If host left or no players remain, delete the game
      if (game.hostId === socket.id || game.players.length === 0) {
        console.log(`Deleting game ${code} because host/players left`);
        delete games[code];
      } else if (before !== game.players.length) {
        // Lobby update after player leaves
        io.to(code).emit("lobbyUpdate", {
          code,
          players: game.players,
        });
      }
    }
  });
});

// ----- Start server -----
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`LowLife server listening on port ${PORT}`);
});
