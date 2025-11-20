const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Store active rooms
const rooms = new Map();

function generateCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let result = "";
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // 1. CREATE ROOM
  socket.on('createRoom', (data, callback) => {
    const code = generateCode();
    rooms.set(code, {
      code,
      hostId: socket.id,
      players: [],
      state: 'lobby', // lobby, playing
      turnIndex: 0,
      tardDeck: [] // Will be seeded by host
    });
    callback({ ok: true, code });
  });

  // 2. JOIN ROOM
  socket.on('joinRoom', ({ code, name, tardDeckSeed }, callback) => {
    const room = rooms.get(code);
    if (!room) {
      return callback({ ok: false, error: "Room not found" });
    }
    if (room.state !== 'lobby') {
      return callback({ ok: false, error: "Game already started" });
    }

    // If host joins, seed the deck
    if (socket.id === room.hostId && tardDeckSeed) {
      room.tardDeck = [...tardDeckSeed];
    }

    const newPlayer = { id: socket.id, name, isHost: socket.id === room.hostId };
    room.players.push(newPlayer);
    socket.join(code);

    // Notify everyone in room
    io.to(code).emit('lobbyUpdate', {
      players: room.players,
      hostId: room.hostId,
      code
    });

    callback({ ok: true, id: socket.id, isHost: newPlayer.isHost });
  });

  // 3. START GAME
  socket.on('startGame', ({ code }, callback) => {
    const room = rooms.get(code);
    if (!room) return callback({ ok: false, error: "No room" });
    if (socket.id !== room.hostId) return callback({ ok: false, error: "Not host" });

    room.state = 'playing';
    room.turnIndex = 0;

    // Shuffle TARD deck on server start
    if (room.tardDeck.length > 0) {
      room.tardDeck.sort(() => Math.random() - 0.5);
    }

    io.to(code).emit('gameStarted', {
      players: room.players,
      currentPlayerId: room.players[0].id
    });
    callback({ ok: true });
  });

  // 4. REQUEST MOVE SPIN
  socket.on('requestMoveSpin', ({ code, playerId }, callback) => {
    const room = rooms.get(code);
    if (!room) return;
    
    // Simple roll 1-10
    const roll = Math.floor(Math.random() * 10) + 1;
    
    // Broadcast result so clients animate
    io.to(code).emit('serverMoveSpin', { playerId, roll });

    // Advance turn logic is handled on client visually, 
    // but we update turn index here for the next person
    const pIdx = room.players.findIndex(p => p.id === playerId);
    if (pIdx !== -1) {
      room.turnIndex = (pIdx + 1) % room.players.length;
      // We wait a bit for animation (4s) then signal turn change? 
      // Your client handles turn change logic visually, but we should sync it eventually.
      // For now, we just let the client run the animation. 
      // A robust server would set a timeout to emit 'turnChanged'.
      setTimeout(() => {
        io.to(code).emit('turnChanged', { 
          currentPlayerId: room.players[room.turnIndex].id 
        });
      }, 5000); // 4s animation + buffer
    }
    if (callback) callback({ ok: true });
  });

  // 5. REQUEST EXTRA SPIN (Multipliers, etc)
  socket.on('requestExtraSpin', ({ code, playerId, multiplier }, callback) => {
    const roll = Math.floor(Math.random() * 10) + 1;
    const amount = roll * (multiplier || 1);
    io.to(code).emit('serverExtraSpin', { playerId, roll, amount, multiplier });
    if (callback) callback({ ok: true });
  });

  // 6. REQUEST RESCUE SPIN (Bankruptcy)
  socket.on('requestRescueSpin', ({ code, playerId }, callback) => {
    const roll = Math.floor(Math.random() * 10) + 1;
    io.to(code).emit('serverRescueSpin', { playerId, roll });
    if (callback) callback({ ok: true });
  });

  // 7. DRAW TARD CARD
  socket.on('requestTardDraw', ({ code, playerId }, callback) => {
    const room = rooms.get(code);
    if (!room) return;

    let card = "No cards left!";
    if (room.tardDeck.length > 0) {
      card = room.tardDeck.pop();
    }
    
    io.to(code).emit('serverTardDraw', { 
      playerId, 
      card, 
      remaining: room.tardDeck.length 
    });
    if (callback) callback({ ok: true });
  });

  // 8. CLAIM FINISH BONUS
  socket.on('claimFinishBonus', ({ code, playerId }, callback) => {
    const room = rooms.get(code);
    if (!room) return;
    // Only give bonus to the first person who claims it? 
    // Or logic handled by client. We just echo it.
    io.to(code).emit('finishBonusAwarded', { playerId, amount: 5000 });
  });

  socket.on('disconnect', () => {
    // Cleanup logic if needed
    console.log('User disconnected:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Lowlife Server running on port ${PORT}`);
});