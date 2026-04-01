let mappa = new Mappa("Leaflet");
let myMap;
let canvas;
let currentLongitude = 0;
let currentLatitude = 0;
let mapInit = false;
let me;
let socket;
if(location.hostname.toLowerCase().startsWith('browsercircus') || location.hostname.toLowerCase().startsWith('www')){
  socket = io({path: "/riley/port-4300/socket.io"}); 
}else{
  socket = io(); 
}

let mySocketId = null;
let otherPlayers = {};
let playerPoints = {};
let gameArea = null;
let isReady = false;
let readyPlayers = {};
let gameStarted = false;
let myRole = null;
let hunterId = null;
let hunterCircles = [];
let scores = {};
let amInCircle = false;
let nextPlaceAt = 0;

let mappa_options = {
  lat: 0,
  lng: 0,
  zoom: 16,
  style: "https://wprd01.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&lang=zh_cn&size=1&scl=2&style=7"
};

socket.on("connect", () => {
  mySocketId = socket.id;
});

socket.on("welcome", (data) => {
  mySocketId = data.id;
  otherPlayers = data.players || {};
  if (data.gameArea) gameArea = data.gameArea;
  if (data.readyPlayers) readyPlayers = data.readyPlayers;
  if (data.hunterCircles) hunterCircles = data.hunterCircles;
  if (data.scores) scores = data.scores;
  if (data.nextPlaceAt) nextPlaceAt = data.nextPlaceAt;
  if (data.gameStarted) {
    gameStarted = true;
    hunterId = data.hunterId;
    myRole = mySocketId === hunterId ? "hunter" : "survivor";
    hideReadyButton();
    hideUIOverlay(); // 隐藏输入框容器
    showRoleUI();
  }
  syncPlayerPoints();
});

socket.on("gameArea", (area) => {
  gameArea = area;
});

socket.on("readyPlayers", (rp) => {
  readyPlayers = rp || {};
  updateReadyCount();
});

socket.on("gameStart", (data) => {
  gameStarted = true;
  hunterId = data.hunterId;
  myRole = mySocketId === hunterId ? "hunter" : "survivor";
  hideReadyButton();
  hideUIOverlay(); // 隐藏输入框容器
  showRoleUI();
});

socket.on("hunterCircles", (circles) => {
  hunterCircles = circles || [];
});

socket.on("scores", (s) => {
  scores = s || {};
});

socket.on("inCircle", (val) => {
  amInCircle = val;
});

socket.on("cooldownStart", (data) => {
  nextPlaceAt = data.nextPlaceAt;
});

socket.on("cooldownReject", (data) => {
  nextPlaceAt = data.nextPlaceAt;
});

// 新增逻辑：处理游戏重置
socket.on("gameReset", () => {
  location.reload();
});

socket.on("players", (players) => {
  otherPlayers = players || {};
  updatePlayerCount();
  syncPlayerPoints();
  if (mapInit) {
    updateMapContent();
  }
});

function updatePlayerCount() {
  let count = Object.keys(otherPlayers).length;
  let el = document.getElementById("player-count");
  if (el) el.textContent = "Players: " + count;
}

function setup() {
  canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("p5-canvas-container");
  me = new PlayerPoint(color(170, 240, 190), true);
}

function draw() {
  clear();

  if (!mapInit && GPS_GRANTED && currentLongitude !== 0) {
    console.log("initializing map");
    mappa_options.lat = currentLatitude;
    mappa_options.lng = currentLongitude;
    myMap = mappa.tileMap(mappa_options);
    myMap.overlay(canvas);
    myMap.onChange(updateMapContent);
    mapInit = true;
  }

  if (mapInit) {
    drawGameArea();
    drawHunterCircles();
    me.update();
    me.display();
    for (let id in playerPoints) {
      if (gameStarted && myRole === "survivor" && id === hunterId) continue;
      playerPoints[id].update();
      playerPoints[id].display();
    }
    if (gameStarted) drawRoleHUD();
  }
}

function mousePressed() {
  if (!mapInit || !gameStarted || myRole !== "hunter") return;
  let pos = myMap.pixelToLatLng(mouseX, mouseY);
  socket.emit("placeCircle", { 
    latitude: pos.lat, 
    longitude: pos.lng 
  });
  return false; 
}//将TOUCHED改成了MOUSEPRESSED

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function handleNewPosition(pos) {
  console.log("NEW LOC", pos);
  me.accuracy = pos.coords.accuracy;

  let lonlat = fixForChineseMap(pos);
  currentLongitude = lonlat[0];
  currentLatitude = lonlat[1];

  socket.emit("updateLocation", {
    latitude: currentLatitude,
    longitude: currentLongitude,
    accuracy: me.accuracy,
  });

  if (mapInit) {
    updateMapContent();
  }
}

function updateMapContent() {
  let myPosOnCanvas = myMap.latLngToPixel(currentLatitude, currentLongitude);
  me.goalX = myPosOnCanvas.x;
  me.goalY = myPosOnCanvas.y;

  for (let id in playerPoints) {
    let player = otherPlayers[id];
    if (!player) continue;
    let posOnCanvas = myMap.latLngToPixel(player.latitude, player.longitude);
    playerPoints[id].goalX = posOnCanvas.x;
    playerPoints[id].goalY = posOnCanvas.y;
    playerPoints[id].accuracy = player.accuracy || 0;
    playerPoints[id].playerName = player.name || "";
    playerPoints[id].playerColor = player.color || null;
  }
}

function metersToPixel(meters, lat) {
  let z = myMap.zoom();
  const mpp = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, z);
  return meters / mpp;
}

function drawGameArea() {
  if (!gameArea) return;
  let nw = myMap.latLngToPixel(gameArea.north, gameArea.west);
  let se = myMap.latLngToPixel(gameArea.south, gameArea.east);
  let x = nw.x;
  let y = nw.y;
  let w = se.x - nw.x;
  let h = se.y - nw.y;
  noFill();
  stroke(255, 200, 0);
  strokeWeight(3);
  rect(x, y, w, h);
  fill(0, 0, 0, 80);
  noStroke();
  rect(0, 0, width, y);
  rect(0, y + h, width, height - (y + h));
  rect(0, y, x, h);
  rect(x + w, y, width - (x + w), h);
}

function drawHunterCircles() {
  if (!gameStarted) return;
  if (myRole === "hunter") {
    for (let circ of hunterCircles) {
      let pos = myMap.latLngToPixel(circ.latitude, circ.longitude);
      let diameterPx = 2 * metersToPixel(circ.radius, circ.latitude);
      fill(200, 0, 0, 40);
      stroke(200, 0, 0, 150);
      strokeWeight(2);
      circle(pos.x, pos.y, diameterPx);
    }
  }
  
  // 增加PRAY在圈内的红色闪烁预警
  if (myRole === "survivor" && amInCircle) {
    let flashAlpha = map(sin(frameCount * 0.15), -1, 1, 40, 160); 
    fill(255, 0, 0, flashAlpha);
    noStroke();
    rect(0, 0, width, height);
    
    fill(255);
    noStroke();
    textSize(24);
    textAlign(CENTER);
    text("WARNING: IN HUNTER CIRCLE!", width / 2, height / 2);
    
    fill(255, 200, 200);
    textSize(16);
    text("Your score gain is PAUSED", width / 2, height / 2 + 40);
    textAlign(LEFT);
  }
}

class PlayerPoint {
  constructor(col, isMe) {
    this.x = 0; this.y = 0;
    this.goalX = 0; this.goalY = 0;
    this.size = 14;
    this.col = col;
    this.isMe = isMe || false;
    this.accuracy = 0;
    this.playerName = "";
    this.playerColor = null;
  }
  update() {
    this.x = lerp(this.x, this.goalX, 0.2);
    this.y = lerp(this.y, this.goalY, 0.2);
  }
  display() {
    push();
    translate(this.x, this.y);
    noFill();
    stroke("red");
    let diameter = 2 * metersToPixel(this.accuracy, currentLatitude);
    circle(0, 0, diameter);
    fill("red");
    noStroke();
    if (mapInit) { textSize(map(myMap.zoom(), 9, 18, 0, 12)); }
    text("acc:" + Math.floor(this.accuracy) + "m", diameter / 2 + 1, 0);

    let displayCol = this.playerColor ? color(this.playerColor) : this.col;
    fill(displayCol);
    stroke(this.isMe ? "pink" : "white");
    strokeWeight(3);
    let dia = this.size + sin(frameCount * 0.1);
    circle(0, 0, dia);

    if (mapInit) {
      noStroke();
      fill(0);
      textAlign(CENTER);
      textSize(map(myMap.zoom(), 9, 18, 0, 11));
      let myScore = Math.floor(scores[this.isMe ? mySocketId : this.playerName] || 0);
      let label = (this.isMe ? "You" : this.playerName) + " (" + (scores[this.isMe ? mySocketId : this.getIDfromName(this.playerName)] || 0) + ")";
      text(label, 0, -dia / 2 - 6);
      textAlign(LEFT);
    }
    pop();
  }
  // 根据名字找分（
  getIDfromName(name){
      for(let id in otherPlayers){ if(otherPlayers[id].name === name) return id; }
      return name;
  }
}

function syncPlayerPoints() {
  let nextPoints = {};
  for (let id in otherPlayers) {
    if (id === mySocketId) continue;
    let existing = playerPoints[id];
    if (existing) { nextPoints[id] = existing; continue; }
    let pt = new PlayerPoint(color(170, 190, 240), false);
    nextPoints[id] = pt;
  }
  playerPoints = nextPoints;
}

//增加ID输入
function toggleReady() {
  if (gameStarted) return;
  
  let inputField = document.getElementById("userNameInput");
  let chosenName = inputField ? inputField.value.trim() : "";
  socket.emit("setName", chosenName || "Player_" + mySocketId.substring(0,4));
  isReady = true;
  socket.emit("ready");
  
  let btn = document.getElementById("readyButton");
  if(btn) {
    btn.textContent = "Waiting...";
    btn.style.background = "#888";
    btn.disabled = true;
  }
}

function updateReadyCount() {
  let total = Object.keys(otherPlayers).length;
  let ready = Object.keys(readyPlayers).length;
  let btn = document.getElementById("readyButton");
  if (!btn || gameStarted) return;
  if (isReady) {
    btn.textContent = "Waiting... (" + ready + "/" + total + ")";
  }
}

function hideReadyButton() {
  let btn = document.getElementById("readyButton");
  if (btn) btn.style.display = "none";
}

// 隐藏输入UI
function hideUIOverlay() {
  let ui = document.getElementById("ui-overlay");
  if (ui) ui.style.display = "none";
}

function showRoleUI() {
  let banner = document.getElementById("roleBanner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "roleBanner";
    banner.style.cssText = "position:fixed;top:60px;left:50%;transform:translateX(-50%);z-index:1000;padding:10px 24px;border-radius:10px;font-family:sans-serif;font-size:16px;font-weight:bold;color:white;";
    document.body.appendChild(banner);
  }
  if (myRole === "hunter") {
    banner.textContent = "You are the Hunter";
    banner.style.background = "rgba(200,0,0,0.8)";
  } else {
    banner.textContent = "You are a Survivor";
    banner.style.background = "rgba(0,100,200,0.8)";
  }
}

function drawRoleHUD() {
  push();
  let myScore = Math.floor(scores[mySocketId] || 0);
  if (myRole === "hunter") {
    let cooldownLeft = Math.max(0, Math.ceil((nextPlaceAt - Date.now()) / 1000));
    let cooldownText = cooldownLeft > 0 ? "Cooldown: " + cooldownLeft + "s" : "Tap to place circle";
    fill(200, 0, 0); noStroke(); textSize(14); textAlign(LEFT);
    text("Score: " + myScore + "  |  Circles: " + hunterCircles.length + "  |  " + cooldownText, 20, height - 20);
  } else {
    fill(0, 100, 200); noStroke(); textSize(14); textAlign(LEFT);
    text("Score: " + myScore + "  |  Stay close to other survivors!", 20, height - 20);
  }
  pop();
}