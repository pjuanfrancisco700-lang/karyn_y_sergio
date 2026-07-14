(() => {
  "use strict";

  const cfg = window.GAME_CONFIG;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  const state = {
    me: localStorage.getItem("isla_player") || "",
    game: null,
    players: [],
    selectedCell: "",
    selectedEmoji: "😏",
    timer: cfg.TURN_SECONDS,
    timerHandle: null,
    pollHandle: null,
    sound: localStorage.getItem("isla_sound") !== "off",
    lastMessageId: ""
  };

  const terrainEmoji = {
    Playa: "🏖️",
    Selva: "🌴",
    Río: "🌊",
    Montaña: "⛰️",
    Cueva: "🕳️"
  };

  document.addEventListener("gesturestart", e => e.preventDefault());
  document.addEventListener("dblclick", e => e.preventDefault(), { passive:false });
  document.addEventListener("touchmove", e => {
    if (e.scale && e.scale !== 1) e.preventDefault();
  }, { passive:false });

  function vibrate(ms=18){ if (navigator.vibrate) navigator.vibrate(ms); }

  function showToast(text){
    const el = $("#toast");
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("show"), 1800);
  }

  function openModal(id){ $("#" + id).classList.add("open"); }
  function closeModal(id){ $("#" + id).classList.remove("open"); }

  async function api(action, payload = {}){
    if (!cfg.API_URL || cfg.API_URL.includes("PEGA_AQUI")) {
      return demoApi(action, payload);
    }
    const res = await fetch(cfg.API_URL, {
      method: "POST",
      redirect: "follow",
      cache: "no-store",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, partidaId: cfg.PARTIDA_ID, ...payload })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Error del servidor");
    return json.data;
  }

  function demoApi(action, payload){
    const demoPlayers = [
      {ID_Jugador:"J1",Nombre:"Jugador 1",Avatar:"🧑‍🚀",Vida:100,Comida:60,Agua:60,Energía:100,Monedas:12,Puntos:25,Posición:"A1",Escudo:0,Estado:"Activo"},
      {ID_Jugador:"J2",Nombre:"Jugador 2",Avatar:"🧑‍🚀",Vida:88,Comida:54,Agua:57,Energía:85,Monedas:8,Puntos:18,Posición:"J10",Escudo:5,Estado:"Activo"}
    ];
    if (action === "estado" || action === "getState") {
      return Promise.resolve({
        partida:{ID_Partida:"PARTIDA-001",Estado:"En curso",Ronda:1,"Turno actual":"J1"},
        jugadores:demoPlayers, mensajes:[]
      });
    }
    if (action === "leerMensajes") return Promise.resolve([]);
    if (action === "enviarMensaje") return Promise.resolve({enviado:true});
    if (action === "jugar") {
      return Promise.resolve({
        resultado: payload.accion + " completado.",
        evento: Math.random() > .6 ? {emoji:"🍎",nombre:"Frutas silvestres",descripcion:"Encontraste alimento."} : null,
        estado:{
          partida:{ID_Partida:"PARTIDA-001",Estado:"En curso",Ronda:1,"Turno actual":payload.jugadorId==="J1"?"J2":"J1"},
          jugadores:demoPlayers, mensajes:[]
        }
      });
    }
    return Promise.resolve({});
  }

  function player(id){ return state.players.find(p => p.ID_Jugador === id) || {}; }
  function enemy(){ return player(state.me === "J1" ? "J2" : "J1"); }
  function me(){ return player(state.me); }

  function buildBoard(){
    const board = $("#islandBoard");
    board.innerHTML = "";
    for(let r=1;r<=10;r++){
      for(let c=1;c<=10;c++){
        const id = String.fromCharCode(64+r)+c;
        const tile = document.createElement("button");
        const types = ["Playa","Selva","Río","Montaña","Cueva"];
        const type = types[(r+c)%types.length];
        tile.className = "tile hidden";
        tile.dataset.id = id;
        tile.dataset.type = type;
        tile.textContent = terrainEmoji[type];
        tile.addEventListener("click", () => selectCell(id, tile));
        board.appendChild(tile);
      }
    }
  }

  function selectCell(id, tile){
    $$(".tile").forEach(t => t.classList.remove("selected"));
    tile.classList.add("selected");
    state.selectedCell = id;
    vibrate();
  }

  function render(){
    if (!state.game || !state.players.length) return;
    const p1 = player("J1"), p2 = player("J2");
    const set = (id,val) => { const el=$(id); if(el) el.textContent = val ?? ""; };

    set("#p1Name", p1.Nombre); set("#p2Name", p2.Nombre);
    set("#joinP1Name", p1.Nombre); set("#joinP2Name", p2.Nombre);
    set("#p1Avatar", p1.Avatar || "🧑‍🚀"); set("#p2Avatar", p2.Avatar || "🧑‍🚀");
    ["Vida","Comida","Agua","Energia"].forEach(k => {
      const key = k === "Energia" ? "Energía" : k;
      set(`#p1${k}`, p1[key]); set(`#p2${k}`, p2[key]);
    });

    set("#roundNumber", state.game.Ronda || 1);
    const current = player(state.game["Turno actual"]);
    set("#turnText", current.Nombre || "Esperando");
    $("#player1Card").classList.toggle("active", state.game["Turno actual"] === "J1");
    $("#player2Card").classList.toggle("active", state.game["Turno actual"] === "J2");

    const mine = me();
    set("#myScore", mine.Puntos || 0);
    set("#myCoins", mine.Monedas || 0);
    set("#myShield", mine.Escudo || 0);

    $$(".tile").forEach(t => {
      t.classList.toggle("player-one", p1.Posición === t.dataset.id);
      t.classList.toggle("player-two", p2.Posición === t.dataset.id);
    });

    const myTurn = state.game["Turno actual"] === state.me && state.game.Estado === "En curso";
    $$(".action-btn").forEach(b => b.disabled = !myTurn);
    if(myTurn) resetTimer();
  }

  async function refresh(){
    try{
      const data = await api("estado");
      state.game = data.partida;
      state.players = data.jugadores || [];
      render();
      await checkMessages();
    }catch(err){
      showToast(err.message);
    }
  }

  async function checkMessages(){
    if(!state.me) return;
    try{
      const messages = await api("leerMensajes",{jugadorId:state.me});
      const incoming = messages.filter(m => m.Para === state.me);
      const latest = incoming[incoming.length-1];
      if(latest && latest.ID_Mensaje !== state.lastMessageId){
        state.lastMessageId = latest.ID_Mensaje;
        $("#bubbleEmoji").textContent = latest.Emoji || "🙂";
        $("#bubbleFrom").textContent = player(latest.De).Nombre || "Jugador";
        $("#bubbleText").textContent = latest.Mensaje || "";
        $("#messageBubble").classList.remove("hidden");
        setTimeout(()=>$("#messageBubble").classList.add("hidden"),5000);
      }
    }catch(_){}
  }

  async function play(action){
    if(!state.me) return;
    const payload = { jugadorId:state.me, accion:action };
    if(action === "Explorar" || action === "Moverse"){
      if(!state.selectedCell){
        showToast("Selecciona una casilla");
        return;
      }
      payload.casilla = state.selectedCell;
    }
    try{
      vibrate(28);
      const data = await api("jugar", payload);
      state.game = data.estado.partida;
      state.players = data.estado.jugadores;
      $("#resultEmoji").textContent = data.evento?.emoji || actionEmoji(action);
      $("#resultTitle").textContent = data.evento?.nombre || action;
      $("#resultText").textContent = data.evento?.descripcion || data.resultado;
      openModal("resultModal");
      render();
    }catch(err){
      showToast(err.message);
    }
  }

  function actionEmoji(action){
    return {
      "Explorar":"🧭","Buscar comida":"🍖","Buscar agua":"💧",
      "Descansar":"😴","Atacar":"⚔️","Defender":"🛡️"
    }[action] || "🏝️";
  }

  async function sendMessage(){
    const text = $("#messageInput").value.trim();
    try{
      await api("enviarMensaje",{
        de:state.me, para:enemy().ID_Jugador,
        emoji:state.selectedEmoji, mensaje:text, duracionSeg:20
      });
      $("#messageInput").value = "";
      closeModal("messageModal");
      showToast("Mensaje enviado");
    }catch(err){ showToast(err.message); }
  }

  function renderInventory(){
    const list = $("#inventoryList");
    const items = [
      ["🪵","Madera",3],["🍖","Comida",2],["💧","Agua",4],["🩹","Botiquín",1]
    ];
    list.innerHTML = items.map(i => `
      <div class="inventory-item">
        <div><span style="font-size:24px">${i[0]}</span> <strong>${i[1]}</strong></div>
        <span>x${i[2]}</span>
      </div>`).join("");
  }

  function resetTimer(){
    state.timer = cfg.TURN_SECONDS;
    clearInterval(state.timerHandle);
    state.timerHandle = setInterval(()=>{
      state.timer--;
      $("#timerText").textContent = state.timer;
      const offset = 113 - (113 * state.timer / cfg.TURN_SECONDS);
      $("#timerProgress").style.strokeDashoffset = offset;
      if(state.timer <= 0){
        clearInterval(state.timerHandle);
        showToast("Turno agotado");
      }
    },1000);
  }

  function choosePlayer(id){
    state.me = id;
    localStorage.setItem("isla_player",id);
    closeModal("joinModal");
    render();
  }

  function bind(){
    $$(".join-player").forEach(b => b.addEventListener("click",()=>choosePlayer(b.dataset.player)));
    $$(".action-btn").forEach(b => b.addEventListener("click",()=>play(b.dataset.action)));
    $("#inventoryBtn").addEventListener("click",()=>{renderInventory();openModal("inventoryModal")});
    $("#messageBtn").addEventListener("click",()=>openModal("messageModal"));
    $$(".emoji-chip").forEach(b => b.addEventListener("click",()=>{
      state.selectedEmoji=b.dataset.emoji;openModal("messageModal");
      $$(".emoji-choice").forEach(e=>e.classList.toggle("selected",e.dataset.emoji===state.selectedEmoji));
    }));
    $$(".emoji-choice").forEach(b => b.addEventListener("click",()=>{
      state.selectedEmoji=b.dataset.emoji;
      $$(".emoji-choice").forEach(e=>e.classList.toggle("selected",e===b));
    }));
    $("#sendMessageBtn").addEventListener("click",sendMessage);
    $$(".close-modal").forEach(b => b.addEventListener("click",()=>closeModal(b.dataset.close)));
    $("#soundBtn").addEventListener("click",()=>{
      state.sound=!state.sound;
      localStorage.setItem("isla_sound",state.sound?"on":"off");
      $("#soundIcon").textContent=state.sound?"🔊":"🔇";
    });
  }

  function registerPWA(){
    if("serviceWorker" in navigator){
      navigator.serviceWorker.register("./sw.js").catch(()=>{});
    }
  }

  buildBoard();
  bind();
  registerPWA();
  refresh();
  state.pollHandle = setInterval(refresh,cfg.POLL_INTERVAL_MS);
  if(state.me) closeModal("joinModal");
})();
