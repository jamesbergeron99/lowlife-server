<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>LowLife Multiplayer</title>
<style>
  body { background:#111; color:white; font-family:Arial; text-align:center; }
  #board { display:grid; grid-template-columns:repeat(20,1fr); gap:4px; width:90%; margin:20px auto; }
  .sq { height:45px; background:#333; display:flex; align-items:center; justify-content:center; }
  .p { background:yellow; color:black; padding:2px 4px; border-radius:4px; }
</style>
</head>
<body>

<h1>The Game of LowLife</h1>
<button id="createBtn">Create Game</button>
<input id="codeInput" placeholder="Enter Code">
<input id="nameInput" placeholder="Your Name">
<button id="joinBtn">Join Game</button>

<h2 id="gameCode"></h2>
<button id="startBtn" style="display:none;">Start Game</button>
<button id="spinBtn" style="display:none;">SPIN</button>

<div id="turn"></div>
<div id="board"></div>

<script>
let ws = new WebSocket("wss://" + window.location.host);
let playerId = null;
let gameCode = null;

const board = document.getElementById("board");

function buildBoard() {
  board.innerHTML = "";
  for (let i = 1; i <= 100; i++) {
    const d = document.createElement("div");
    d.className = "sq";
    d.id = "sq" + i;
    d.textContent = i;
    if (i === 99) d.style.background = "red";
    if (i === 100) d.style.background = "gold";
    board.appendChild(d);
  }
}

buildBoard();

ws.onmessage = e => {
  const m = JSON.parse(e.data);

  if (m.type === "created") {
    document.getElementById("gameCode").textContent = "Game Code: " + m.code;
    gameCode = m.code;
  }

  if (m.type === "joined") {
    playerId = m.id;
    gameCode = document.getElementById("codeInput").value;
    update(m.game);
    document.getElementById("startBtn").style.display = "block";
  }

  if (m.type === "update") update(m.game);
};

function update(g) {
  buildBoard();

  // Render players
  for (let id in g.players) {
    const p = g.players[id];
    const sq = document.getElementById("sq" + (p.position+1));
    sq.innerHTML = (p.position+1) + " <span class='p'>" + p.name[0] + "</span>";
  }

  document.getElementById("turn").textContent =
    "Current Turn: " + g.players[g.turn].name;

  if (g.state === "playing") {
    document.getElementById("spinBtn").style.display = "inline-block";
  }
}

document.getElementById("createBtn").onclick = () => {
  ws.send(JSON.stringify({ type:"create" }));
};

document.getElementById("joinBtn").onclick = () => {
  ws.send(JSON.stringify({
    type:"join",
    code: document.getElementById("codeInput").value,
    name: document.getElementById("nameInput").value
  }));
};

document.getElementById("startBtn").onclick = () => {
  ws.send(JSON.stringify({ type:"start", code: gameCode }));
};

document.getElementById("spinBtn").onclick = () => {
  ws.send(JSON.stringify({ type:"spin", code: gameCode, playerId }));
};
</script>

</body>
</html>
