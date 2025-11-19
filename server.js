// -------------------------------
// The Game of LowLife - SERVER
// WebSocket Multiplayer Version
// -------------------------------

const http = require("http");
const WebSocket = require("ws");

// Render uses process.env.PORT
const PORT = process.env.PORT || 3000;

const server = http.createServer();
const wss = new WebSocket.Server({ server });

// All games stored in memory
const games = {};

function generateGameCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

// Characters with payday
const CHARACTERS = [
  { name: "Slum Lord", payday: 2500 },
  { name: "Gold Digger", payday: 2000 },
  { name: "Pimp", payday: 3000 },
  { name: "Drug Dealer", payday: 2500 },
  { name: "Pornstar", payday: 2500 },
  { name: "Porn Producer", payday: 2500 },
  { name: "Online Influencer", payday: 2500 },
  { name: "Dirty Cop", payday: 2500 }
];

function randomCharacter() {
  return CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
}

function broadcast(gameId, payload) {
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN && ws.gameId === gameId) {
      ws.send(JSON.stringify(payload));
    }
  });
}

wss.on("connection", ws => {

  ws.on("message", msg => {
    const data = JSON.parse(msg);

    // -----------------------------
    // CREATE GAME
    // -----------------------------
    if (data.type === "createGame") {
      const gameId = generateGameCode();

      games[gameId] = {
        state: "LOBBY",
        players: {},
        turn: null
      };

      ws.gameId = gameId;

      ws.send(JSON.stringify({
        type: "gameCreated",
        gameId
      }));
    }

    // -----------------------------
    // JOIN GAME
    // -----------------------------
    if (data.type === "joinGame") {
      const { gameId, playerName } = data;

      if (!games[gameId]) {
        ws.send(JSON.stringify({
          type: "error",
          msg: "Game not found."
        }));
        return;
      }

      ws.gameId = gameId;
      ws.playerId = Date.now().toString();

      games[gameId].players[ws.playerId] = {
        id: ws.playerId,
        name: playerName || "Player",
        position: 0,
        money: 0,
        family: 0,
        character: randomCharacter()
      };

      broadcast(gameId, {
        type: "playerList",
        players: games[gameId].players
      });
    }

    // -----------------------------
    // START GAME
    // -----------------------------
    if (data.type === "startGame") {
      const game = games[data.gameId];
      if (!game) return;

      game.state = "PLAYING";

      // First player is first key
      game.turn = Object.keys(game.players)[0];

      broadcast(data.gameId, {
        type: "gameStarted",
        turn: game.turn,
        players: game.players
      });
    }

    // -----------------------------
    // SPIN
    // -----------------------------
    if (data.type === "spin") {
      const { gameId, playerId } = data;
      const game = games[gameId];
      if (!game) return;

      if (game.turn !== playerId) return;

      const roll = Math.floor(Math.random() * 10) + 1;

      const p = game.players[playerId];
      p.position = (p.position + roll) % 100;

      const ids = Object.keys(game.players);
      const idx = ids.indexOf(game.turn);
      game.turn = ids[(idx + 1) % ids.length];

      broadcast(gameId, {
        type: "gameState",
        players: game.players,
        turn: game.turn
      });
    }

  });

});

server.listen(PORT, () => {
  console.log("SERVER RUNNING on port " + PORT);
});
