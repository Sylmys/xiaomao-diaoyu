const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static("public"));
const PORT = process.env.PORT || 3000;
const rooms = new Map();
const SUITS = ["♠", "♥", "♣", "♦"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SEAT_NAMES = ["A", "B", "C", "D"];

function makeDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ suit, rank, id: `${rank}-${suit}` });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
function roomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do { code = Array.from({ length: 6 }, () => chars[crypto.randomInt(chars.length)]).join(""); }
  while (rooms.has(code));
  return code;
}
function connectedCount(room) { return room.players.filter(p => p.socketId).length; }
function nextActiveSeat(room, fromSeat) {
  for (let step = 1; step <= room.players.length; step++) {
    const seat = (fromSeat + step) % room.players.length;
    if (room.hands[seat].length > 0) return seat;
  }
  return -1;
}
function publicState(room) {
  return {
    code: room.code,
    maxPlayers: room.maxPlayers,
    players: room.players.map((p, i) => ({ seat: i, name: p.name, connected: Boolean(p.socketId) })),
    status: room.status,
    turn: room.turn,
    table: room.table.map(c => ({ ...c })),
    handCounts: room.hands.map(h => h.length),
    capturedCounts: room.captured.map(h => h.length),
    lastAction: room.lastAction,
    winners: room.winners,
    message: room.message
  };
}
function emitState(room) { io.to(room.code).emit("state", publicState(room)); }
function startGame(room) {
  const deck = makeDeck();
  room.hands = Array.from({ length: room.maxPlayers }, () => []);
  const offset = room.maxPlayers === 3 ? crypto.randomInt(3) : 0;
  deck.forEach((card, i) => room.hands[(i + offset) % room.maxPlayers].push(card));
  room.captured = Array.from({ length: room.maxPlayers }, () => []);
  room.table = [];
  room.turn = 0;
  room.status = "playing";
  room.winners = [];
  room.lastAction = null;
  room.message = `游戏开始！玩家${SEAT_NAMES[0]}先出牌。`;
  emitState(room);
}
function finishGame(room) {
  room.status = "finished";
  const max = Math.max(...room.captured.map(cards => cards.length));
  room.winners = room.captured.map((cards, i) => cards.length === max ? i : -1).filter(i => i >= 0);
  const ranking = room.captured.map((cards, i) => ({ seat: i, count: cards.length }))
    .sort((a, b) => b.count - a.count);
  room.message = room.winners.length === room.players.length
    ? "所有玩家收牌数相同，平局！"
    : room.winners.length > 1
      ? `玩家${room.winners.map(i => SEAT_NAMES[i]).join("、")}并列第一！`
      : `玩家${SEAT_NAMES[room.winners[0]]}获胜！`;
  room.ranking = ranking;
  emitState(room);
}
function leaveRoom(socket, reason = "玩家离开房间") {
  const code = socket.data.roomCode;
  if (!code || !rooms.has(code)) return;
  const room = rooms.get(code);
  const idx = room.players.findIndex(p => p.socketId === socket.id);
  if (idx >= 0) {
    room.players[idx].socketId = null;
    room.message = `${room.players[idx].name}已断开连接。${reason}`;
    emitState(room);
  }
  socket.leave(code);
  socket.data.roomCode = null;
  socket.data.seat = null;
}
function cleanName(name, fallback) {
  const value = String(name || "").trim().slice(0, 12);
  return value || fallback;
}

io.on("connection", socket => {
  socket.on("createRoom", ({ name, maxPlayers } = {}, callback = () => {}) => {
    leaveRoom(socket);
    maxPlayers = Math.max(2, Math.min(4, Number(maxPlayers) || 2));
    const code = roomCode();
    const players = Array.from({ length: maxPlayers }, (_, i) => ({
      socketId: null,
      name: `玩家${SEAT_NAMES[i]}`
    }));
    players[0] = { socketId: socket.id, name: cleanName(name, "玩家A") };
    const room = {
      code, maxPlayers, players,
      hands: Array.from({ length: maxPlayers }, () => []),
      captured: Array.from({ length: maxPlayers }, () => []),
      table: [], turn: 0, status: "waiting", winners: [], lastAction: null,
      message: `等待朋友加入（${maxPlayers}人房间）……`
    };
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.seat = 0;
    callback({ ok: true, code, seat: 0 });
    emitState(room);
  });

  socket.on("joinRoom", ({ code, name } = {}, callback = () => {}) => {
    leaveRoom(socket);
    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return callback({ ok: false, error: "房间不存在，请检查房间号。" });
    if (room.status !== "waiting") return callback({ ok: false, error: "游戏已经开始，暂时不能加入。" });
    const seat = room.players.findIndex((p, i) => i > 0 && !p.socketId);
    if (seat < 0) return callback({ ok: false, error: "房间人数已满。" });
    room.players[seat] = { socketId: socket.id, name: cleanName(name, `玩家${SEAT_NAMES[seat]}`) };
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.seat = seat;
    callback({ ok: true, code, seat });
    room.message = connectedCount(room) === room.maxPlayers
      ? "所有玩家已就位，可以开始游戏。"
      : `已有${connectedCount(room)}/${room.maxPlayers}名玩家加入，等待其他朋友……`;
    emitState(room);
  });

  socket.on("startGame", (_, callback = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return callback({ ok: false, error: "请先加入房间。" });
    if (socket.data.seat !== 0) return callback({ ok: false, error: "请由房主开始游戏。" });
    if (connectedCount(room) !== room.maxPlayers) return callback({ ok: false, error: `需要所有${room.maxPlayers}位玩家加入后才能开始。` });
    if (room.status === "playing") return callback({ ok: false, error: "游戏已经开始。" });
    startGame(room);
    callback({ ok: true });
  });

  socket.on("playCard", (_, callback = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    const seat = socket.data.seat;
    if (!room || room.status !== "playing") return callback({ ok: false, error: "当前没有进行中的游戏。" });
    if (seat !== room.turn) return callback({ ok: false, error: "还没轮到你出牌。" });
    if (!room.hands[seat]?.length) return callback({ ok: false, error: "你的手牌已经用完，系统会自动跳过你。" });

    const card = room.hands[seat].shift();
    room.table.push({ ...card, playedBy: seat });
    let matchedAt = -1;
    for (let i = room.table.length - 2; i >= 0; i--) {
      if (room.table[i].rank === card.rank) { matchedAt = i; break; }
    }
    if (matchedAt >= 0) {
      const captured = room.table.splice(matchedAt);
      room.captured[seat].push(...captured);
      room.lastAction = { type: "capture", seat, card: { ...card }, count: captured.length, rank: card.rank };
      room.message = `玩家${SEAT_NAMES[seat]}翻出 ${card.rank}${card.suit}，匹配成功，收走 ${captured.length} 张牌！`;
    } else {
      room.lastAction = { type: "play", seat, card: { ...card } };
      room.message = `玩家${SEAT_NAMES[seat]}翻出 ${card.rank}${card.suit}。`;
    }

    if (room.hands.every(hand => hand.length === 0)) {
      finishGame(room);
      callback({ ok: true });
      return;
    }
    const next = nextActiveSeat(room, seat);
    if (next < 0) {
      finishGame(room);
      callback({ ok: true });
      return;
    }
    room.turn = next;
    const exhausted = room.hands.map((hand, i) => hand.length === 0 ? SEAT_NAMES[i] : null).filter(Boolean);
    if (exhausted.length) room.message += `（玩家${exhausted.join("、")}手牌已出完，自动跳过）`;
    emitState(room);
    callback({ ok: true });
  });

  socket.on("restartGame", (_, callback = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || socket.data.seat !== 0) return callback({ ok: false, error: "只有房主可以重新开始。" });
    if (connectedCount(room) !== room.maxPlayers) return callback({ ok: false, error: "需要所有玩家重新加入后才能开始。" });
    startGame(room);
    callback({ ok: true });
  });
  socket.on("disconnect", () => leaveRoom(socket, "可以刷新页面后重新加入。"));
});

server.listen(PORT, () => console.log(`小猫钓鱼运行于 http://localhost:${PORT}`));