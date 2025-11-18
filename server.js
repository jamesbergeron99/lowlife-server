// server.js

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

// ----- Express setup -----
const app = express();
app.use(express.json());

// CORS: allow any origin (GitHub Pages, Render, etc.)
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
  })
);

// Simple root route so you don't get "Cannot GET /"
app.get("/", (req, res) => {
  res.send("LowLife server is running.");
});

// ----- HTTP + Socket.IO server -----
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// In-memory game store
// games[code] = { code, hostId, players: [{ id, name }], started: false }
const games = {};

// Generate a random 5-character game code
function generateGameCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function createUniqueCode() {
  let code;
  do {
    code = generateGameCode();
  } while (games[code]);
  return code;
}

// Convenience to build a code payload with *multiple* property names
function buildCodePayload(code) {
  return {
    code,          // generic
    gameCode: code,
    roomCode: code,
    lobbyCode: code,
  };
}

// ----- Socket.IO logic -----
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  // Host creates a new game
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

      const payloadOut = buildCodePayload(code);

      // Fire as many likely events/properties as possible
      socket.emit("gameCreated", payloadOut);
      socket.emit("gameCode", payloadOut);
      socket.emit("createdGame", payloadOut);
    } catch (err) {
      console.error("Error in createGame:", err);
      socket.emit("errorMessage", { message: "Failed to create game." });
    }
  });

  // Player joins an existing game
  socket.on("joinGame", (data) => {
    try {
      // Accept various shapes: { code }, { gameCode }, string, etc.
      let code;
      let name;

      if (typeof data === "string") {
        code = data;
        name = "Player";
      } else if (data) {
        code =
          data.code ||
          data.gameCode ||
          data.roomCode ||
          data.lobbyCode ||
          "";
        name = data.name || data.playerName || "Player";
      }

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

      const trimmedName = name.toString().trim() || "Player";
      const player = { id: socket.id, name: trimmedName };

      if (!game.players.find((p) => p.id === socket.id)) {
        game.players.push(player);
      }

      console.log(`Player joined game ${upperCode}: ${trimmedName}`);

      const lobbyPayload = {
        ...buildCodePayload(upperCode),
        players: game.players,
      };

      // Update lobby for everyone
      io.to(upperCode).emit("lobbyUpdate", lobbyPayload);

      // Acknowledge join
      socket.emit("joinedGame", {
        ...buildCodePayload(upperCode),
        player,
      });
    } catch (err) {
      console.error("Error in joinGame:", err);
      socket.emit("joinError", { message: "Failed to join game." });
    }
  });

  // Host starts the game
  socket.on("startGame", (data) => {
    try {
      let code;

      if (typeof data === "string") {
        code = data;
      } else if (data) {
        code =
          data.code ||
          data.gameCode ||
          data.roomCode ||
          data.lobbyCode ||
          "";
      }

      if (!code) {
        console.log("startGame called without a code");
        return;
      }

      const upperCode = code.toUpperCase();
      const game = games[upperCode];

      if (!game) {
        console.log("startGame called for non-existing game:", upperCode);
        return;
      }

      if (game.hostId !== socket.id) {
        console.log("Non-host tried to start game:", socket.id);
        return;
      }

      game.started = true;

      console.log(`Game started: ${upperCode}`);

      const startPayload = {
        ...buildCodePayload(upperCode),
        players: game.players,
        currentTurnIndex: 0,
        started: true,
      };

      // Let all clients know the game has started (front end should listen for this)
      io.to(upperCode).emit("gameStarted", startPayload);
    } catch (err) {
      console.error("Error in startGame:", err);
      socket.emit("errorMessage", { message: "Failed to start game." });
    }
  });

  // Spin handler (optional – just broadcasts the result)
  socket.on("spin", (data) => {
    try {
      let code;
      let roll;
      let playerId;

      if (data) {
        code =
          data.code ||
          data.gameCode ||
          data.roomCode ||
          data.lobbyCode ||
          "";
        roll = data.roll;
        playerId = data.playerId;
      }

      if (!code) return;

      const upperCode = code.toUpperCase();
      const game = games[upperCode];
      if (!game || !game.started) return;

      io.to(upperCode).emit("spinResult", {
        ...buildCodePayload(upperCode),
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

    for (const code of Object.keys(games)) {
      const game = games[code];
      const before = game.players.length;

      game.players = game.players.filter((p) => p.id !== socket.id);

      if (game.hostId === socket.id || game.players.length === 0) {
        console.log(`Deleting game ${code} because host/players left`);
        delete games[code];
      } else if (before !== game.players.length) {
        const lobbyPayload = {
          ...buildCodePayload(code),
          players: game.players,
        };
        io.to(code).emit("lobbyUpdate", lobbyPayload);
      }
    }
  });
});

// ----- Start server -----
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`LowLife server listening on port ${PORT}`);
});
