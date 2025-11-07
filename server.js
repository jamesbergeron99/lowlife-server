// server.js - Backend for Lowlife Game
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// IMPORTANT: REPLACE THE STAR (*) BELOW with your actual GitHub Pages URL 
// Example: const CLIENT_URL = "https://yourusername.github.io/the-game-of-lowlife/";
const CLIENT_URL = "*"; 

const io = new Server(server, {
    cors: {
        origin: CLIENT_URL,
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;
const games = {}; // Stores all active game states by code

// Helper: Generates a simple 4-character code
function generateCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase(); 
}

// Helper: Initializes the game state using names and number of players
function initializeGame(code, names, numPlayers) {
    // --- THIS IS WHERE YOUR ORIGINAL GAME'S ARRAYS AND LOGIC NEED TO BE ---
    // For now, using placeholders:
    const CHARACTERS = [
        { name:'Slum Lord', payday:6500, edu:'High School', paysOff:['Pornstar'] },
        { name:'Gold Digger', payday:7000, edu:'Dropout', paysOff:['Porn Producer'], rentImmunityOnLanding:true }
    ];
    
    // Select a subset of names based on numPlayers
    const playerNames = names.slice(0, numPlayers);
    const shuffledCharacters = CHARACTERS.sort(() => 0.5 - Math.random()); // Simple shuffle for character assignment

    const players = playerNames.map((name, i) => ({
        id: io.sockets.adapter.rooms.get(code) ? Array.from(io.sockets.adapter.rooms.get(code))[i] : `p${i + 1}`, // Attempts to use actual socket IDs for turn logic
        name: name,
        character: shuffledCharacters[i % shuffledCharacters.length],
        position: 0,
        money: 0,
        family: 0,
        lastMoneyDelta: 0,
        color: ['#f44336', '#2196f3', '#4caf50', '#ff9800', '#e91e63', '#00bcd4', '#9c27b0', '#795548'][i % 8]
    }));
    
    // Sort Dropouts first (copying client logic)
    players.sort((a,b)=> (a.character.edu==='Dropout')===(b.character.edu==='Dropout')?0:(a.character.edu==='Dropout'?-1:1));


    games[code] = {
        players: players,
        current: 0,
        tardIndex: 0,
        status: 'In Progress',
        // Add all other necessary state variables here (e.g., TARD_CARDS, EVENTS array)
    };
    return games[code];
}

// --- Socket.IO Connection Handler ---
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // [1] Host creates a game
    socket.on('createGame', () => {
        let code = generateCode();
        while (games[code]) { code = generateCode(); } 
        
        socket.join(code);
        games[code] = { 
            code: code, 
            hostId: socket.id, 
            playersInLobby: [{ id: socket.id, name: "Host" }], 
            numPlayers: 2, 
            status: 'Lobby' 
        };
        socket.emit('gameCreated', { code: code, isHost: true, numPlayers: 2 });
        console.log(`Game created: ${code} by ${socket.id}`);
    });

    // [2] Player joins a game
    socket.on('joinGame', ({ code, name = "Player" }) => {
        const game = games[code];
        if (!game || game.status !== 'Lobby') {
            return socket.emit('error', 'Game not found or already started.');
        }
        
        if (game.playersInLobby.length >= 8) {
            return socket.emit('error', 'Game is full (8 players max).');
        }

        socket.join(code);
        game.playersInLobby.push({ id: socket.id, name: name });
        
        socket.emit('gameJoined', { code: code, isHost: false, numPlayers: game.numPlayers });
        io.to(code).emit('lobbyUpdate', game.playersInLobby);
        console.log(`Player ${socket.id} joined game ${code}. Current players: ${game.playersInLobby.length}`);
    });

    // [3] Host updates settings (like player count)
    socket.on('updateSettings', ({ code, numPlayers }) => {
        const game = games[code];
        if (!game || game.hostId !== socket.id || game.status !== 'Lobby') return;
        
        game.numPlayers = parseInt(numPlayers) || 2;
        io.to(code).emit('settingsUpdate', game.numPlayers);
        console.log(`Game ${code}: Host updated player count to ${game.numPlayers}`);
    });

    // [4] Host starts the game
    socket.on('startGame', ({ code, names }) => {
        const game = games[code];
        if (!game || game.hostId !== socket.id || game.status !== 'Lobby') {
            return socket.emit('error', 'Only the host can start the game.');
        }

        const initialState = initializeGame(code, names, game.numPlayers);
        game.status = 'In Progress';
        
        io.to(code).emit('gameStarted', initialState);
        console.log(`Game ${code} started with ${game.numPlayers} players.`);
    });
    
    // [5] Player makes a move (SPIN)
    socket.on('playerSpin', ({ code }) => {
        const game = games[code];
        // Basic validation: Check if game exists, is in progress, and it's this player's turn
        if (!game || game.status !== 'In Progress' || game.players[game.current].id !== socket.id) {
            return socket.emit('error', 'It is not your turn or the game is invalid.');
        }

        // --- CORE GAME LOGIC GOES HERE ---
        const roll = Math.floor(Math.random() * 10) + 1;
        
        // This is where you call your server-side versions of:
        // moveBy(game.players[game.current], roll);
        
        // Example logic placeholder: move and advance turn
        game.players[game.current].position = (game.players[game.current].position + roll) % 100; // Assuming 100 squares
        game.current = (game.current + 1) % game.players.length; 
        // --- END CORE GAME LOGIC ---

        const updatedState = games[code]; // The full updated state
        io.to(code).emit('gameStateUpdate', updatedState);
        console.log(`Game ${code}: Spin by ${socket.id}. Roll: ${roll}.`);
    });
    
    // [6] Handle disconnection
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        // To-Do: Add logic to remove players from games/lobbies when they disconnect
    });
});

server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});