const WebSocket = require('ws');
const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port: PORT });

// --- GAME DATA ---
const EVENTS = [
    "Start", "Payday", "Lose $500", "Space 4", "Space 5", 
    "Payday", "Spin times 100", "Tard card", "Lottery spin 5 to win", 
    "Payday", "Gain a family member", "Lose job", "Payday", "Finish"
];
const TARD_CARDS = [
    "Payoff Card: Developer", "Lose 1 family member", 
    "Go back 3 spaces", "Payoff Card: Manager"
];
const CHARACTERS = [
    {name: "Dev", payday: 5000, paysOff: []}, 
    {name: "Manager", payday: 8000, paysOff: ["Dev"]}
];
// ----------------

const START_MONEY = 0;
const START_FAMILY = 0;
const games = new Map();

function shuffle(array) {
  for(let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function getRandomColor() {
  const colors = ['#e53935','#8e24aa','#3949ab','#00acc1','#43a047','#fb8c00','#7b1fa2'];
  return colors[Math.floor(Math.random() * colors.length)];
}

wss.on('connection', ws => {
  let game = null;
  let playerId = null;

  ws.on('message', data => {
    let msg;
    try { msg = JSON.parse(data); } catch(e) { return; }

    if(msg.type === 'joinGame') {
      let gameId = msg.gameId || null;
      const playerName = msg.playerName || 'Lowlife';

      if(!gameId) gameId = Math.random().toString(36).substring(2,8).toUpperCase();

      if(!games.has(gameId)) {
        games.set(gameId, {
          state: 'lobby',
          gameId: gameId,
          players: new Map(),
          deck: shuffle([...TARD_CARDS]),
          firstFinisher: null
        });
      }
      game = games.get(gameId);
      playerId = Math.random().toString(36).substring(2,12);
      
      game.players.set(playerId, {
        ws: ws,
        id: playerId,
        name: playerName,
        color: getRandomColor(),
        position: 0,
        money: START_MONEY,
        family: START_FAMILY,
        character: null,
        missedNextPayday: false,
        missedTurns: 0
      });

      ws.send(JSON.stringify({
        type: 'welcome',
        yourId: playerId,
        gameId,
        gameState: getGameState(game)
      }));
      broadcast(game, {type: 'gameUpdate', gameState: getGameState(game)});
    }

    if(msg.type === 'startGame' && game && game.state === 'lobby') {
      game.state = 'playing';
      const chars = shuffle([...CHARACTERS]);
      let i = 0;
      for(let p of game.players.values()) {
        p.character = chars[i++ % chars.length];
        p.money = START_MONEY;
        p.family = START_FAMILY;
        p.missedNextPayday = false;
        p.missedTurns = 0;
      }
      game.turnIndex = Math.floor(Math.random() * game.players.size);
      game.turnPlayerId = Array.from(game.players.keys())[game.turnIndex];
      broadcast(game, {type: 'gameStarted', gameState: getGameState(game)});
    }

    if(msg.type === 'spin' && game && game.state === 'playing' && game.turnPlayerId === playerId && !game.currentRoll) {
      const roll = Math.floor(Math.random() * 10) + 1;
      game.currentRoll = roll;
      broadcast(game, {type: 'roll', playerId, roll});
      setTimeout(() => processMove(game, playerId, roll), 2000);
    }
  });

  ws.on('close', () => {
    if(game && playerId) {
      game.players.delete(playerId);
      if(game.players.size === 0) games.delete(game.gameId);
      else broadcast(game, {type: 'gameUpdate', gameState: getGameState(game)});
    }
  });
});

function broadcast(game, msg) {
  if(!game) return;
  game.players.forEach(p => {
    if (p.ws && p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify(msg));
  });
}

function getGameState(game) {
  const players = {};
  game.players.forEach(p => {
    players[p.id] = {
      id: p.id,
      name: p.name,
      color: p.color,
      character: p.character,
      position: p.position,
      money: p.money,
      family: p.family
    };
  });
  return { state: game.state, players, turn: game.turnPlayerId };
}

function processMove(game, playerId, roll) {
  const player = game.players.get(playerId);
  if(!player) return;

  if(player.missedTurns > 0) {
    player.missedTurns--;
    broadcast(game, {type:'message', text: `${player.name} misses turn`});
    nextTurn(game);
    game.currentRoll = null;
    return;
  }
  
  if(player.missedNextPayday) player.missedNextPayday = false;
  player.position += roll;
  if (player.position >= EVENTS.length) player.position = EVENTS.length - 1;

  let text = EVENTS[player.position];
  if(text && text.includes('Payday') && player.character) {
      player.money += player.character.payday;
      broadcast(game, {type: 'message', text: 'PAYDAY!'});
  }
  
  // Simple Tard Card Logic
  if(text && text.includes('Tard card')) {
      if(game.deck.length === 0) game.deck = shuffle([...TARD_CARDS]);
      const card = game.deck.pop();
      broadcast(game, {type: 'tardCard', playerId, card});
  }

  broadcast(game, {type:'gameUpdate', gameState: getGameState(game)});
  game.currentRoll = null;
  nextTurn(game);
}

function nextTurn(game) {
  const ids = Array.from(game.players.keys());
  game.turnIndex = (game.turnIndex + 1) % ids.length;
  game.turnPlayerId = ids[game.turnIndex];
  broadcast(game, {type:'gameUpdate', gameState: getGameState(game)});
}

console.log(`Server running on ${PORT}`);