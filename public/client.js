const socket = io();
const $ = id => document.getElementById(id);
let mySeat = null, roomCode = null, latestState = null, toastTimer;
const seatLetters = ["A", "B", "C", "D"];
function toast(message) { const el = $("toast"); el.textContent = message; el.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 2300); }
function showError(message) { $("lobbyError").textContent = message || ""; }
function playerName() { return $("playerName").value.trim().slice(0, 12) || "玩家"; }
function request(event, payload = {}) { return new Promise(resolve => socket.emit(event, payload, resolve)); }
function enterRoom(result) {
  if (!result.ok) return showError(result.error);
  roomCode = result.code; mySeat = result.seat;
  $("lobby").classList.add("hidden"); $("game").classList.remove("hidden");
  $("roomCode").textContent = roomCode; $("mySeat").textContent = `你是玩家${seatLetters[mySeat]}`; showError("");
}
function renderCard(card) {
  const div = document.createElement("div"); div.className = `card ${["♥", "♦"].includes(card.suit) ? "red" : ""}`;
  const rank = document.createElement("span"); rank.className = "rank"; rank.textContent = card.rank;
  const suit = document.createElement("span"); suit.className = "suit"; suit.textContent = card.suit; div.append(rank, suit); return div;
}
function renderPlayers(state) {
  const board = $("scoreboard"); board.replaceChildren();
  state.players.forEach((player, i) => {
    const card = document.createElement("article"); card.className = "player panel" + (state.status === "playing" && state.turn === i ? " active" : "");
    const title = document.createElement("div"); title.className = "player-title";
    const dot = document.createElement("span"); dot.className = "dot";
    const name = document.createElement("strong"); name.textContent = player.name || `玩家${seatLetters[i]}`;
    const tag = document.createElement("span"); tag.className = "tag";
    tag.textContent = !player.connected ? "未加入/离线" : (state.status === "playing" && (state.handCounts[i] || 0) === 0 ? "已出完" : "在线");
    title.append(dot, name, tag);
    const stats = document.createElement("div"); stats.className = "stats";
    [[state.handCounts[i] || 0, "剩余手牌"], [state.capturedCounts[i] || 0, "已收集"]].forEach(([value, label]) => {
      const item = document.createElement("div"), b = document.createElement("b"), small = document.createElement("small");
      b.textContent = value; small.textContent = label; item.append(b, small); stats.append(item);
    });
    if (state.status === "finished") {
      const rank = document.createElement("span"); rank.className = "rank-tag";
      const sorted = [...state.capturedCounts].sort((a,b) => b-a);
      rank.textContent = state.capturedCounts[i] === sorted[0] ? "第一名" : `${sorted.indexOf(state.capturedCounts[i]) + 1}名`;
      stats.append(rank);
    }
    card.append(title, stats); board.append(card);
  });
}
function render(state) {
  latestState = state; $("roomCode").textContent = state.code; $("roomSize").textContent = `· ${state.players.length}人房`;
  renderPlayers(state);
  const cards = $("tableCards"); cards.replaceChildren();
  if (!state.table.length) { const empty = document.createElement("div"); empty.className = "empty-table"; empty.textContent = state.status === "playing" ? "桌面暂无牌，等待翻牌" : "等待开始，桌面上的牌会显示在这里"; cards.append(empty); }
  else state.table.forEach(card => cards.append(renderCard(card)));
  $("tableCount").textContent = `${state.table.length} 张`;
  const playing = state.status === "playing", waiting = state.status === "waiting", isMyTurn = playing && state.turn === mySeat;
  $("turnText").textContent = waiting ? (state.players.every(p => p.connected) ? "所有玩家已就位，等待房主开始" : `等待朋友加入（${state.players.filter(p=>p.connected).length}/${state.players.length}）`) : playing ? (isMyTurn ? "轮到你了！" : `等待玩家${seatLetters[state.turn]}出牌…`) : state.message;
  $("lastAction").textContent = state.message || ""; $("playBtn").disabled = !isMyTurn;
  $("startBtn").classList.toggle("hidden", mySeat !== 0 || !waiting);
  $("startBtn").disabled = !state.players.every(p => p.connected);
  $("restartBtn").classList.toggle("hidden", !(state.status === "finished" && mySeat === 0));
  $("restartBtn").disabled = !state.players.every(p => p.connected);
  $("result").classList.toggle("hidden", state.status !== "finished");
  if (state.status === "finished") {
    const scores = state.capturedCounts.map((n,i) => `玩家${seatLetters[i]}：${n}张`).join("　");
    $("result").textContent = `${state.message} ${scores}`;
  } else $("result").textContent = "";
}
socket.on("connect", () => $("connection").textContent = "已连接");
socket.on("disconnect", () => $("connection").textContent = "连接中断");
socket.on("state", state => { if (roomCode && state.code === roomCode) render(state); });
$("createBtn").onclick = async () => enterRoom(await request("createRoom", { name: playerName(), maxPlayers: Number($("playerCount").value) }));
$("joinBtn").onclick = async () => enterRoom(await request("joinRoom", { code: $("roomInput").value, name: playerName() }));
$("startBtn").onclick = async () => { const r = await request("startGame"); if (!r.ok) toast(r.error); };
$("playBtn").onclick = async () => { $("playBtn").disabled = true; const r = await request("playCard"); if (!r.ok) toast(r.error); };
$("restartBtn").onclick = async () => { const r = await request("restartGame"); if (!r.ok) toast(r.error); };
$("copyBtn").onclick = async () => { try { await navigator.clipboard.writeText(roomCode); toast("房间号已复制"); } catch { toast(`房间号：${roomCode}`); } };
$("leaveBtn").onclick = () => location.reload();