let mappa = new Mappa("Leaflet");
let myMap;
let canvas;
let currentLongitude = 0;
let currentLatitude = 0;
let mapInit = false;
let me;
let socket = io();
let mySocketId = null;
let otherPlayers = {};
let playerPoints = {};
let gameArea = null;

// map tile options — Gaode vector, NO labels (scl=2), GCJ-02 coords
let mappa_options = {
  lat: 0,
  lng: 0,
  zoom: 16,
  style: "https://wprd01.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&lang=zh_cn&size=1&scl=2&style=7",
  // alternatives (all Gaode/AutoNavi, GCJ-02, no API key):
  // blocks + roads, no text:  "https://wprd01.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&lang=zh_cn&size=1&scl=1&style=7&ltype=3"
  // land blocks only:         "https://wprd01.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&lang=zh_cn&size=1&scl=1&style=7&ltype=1"
  // satellite, no labels:     "https://webst01.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}"
  // original with labels:     "https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=7&x={x}&y={y}&z={z}"
};

socket.on("connect", () => {
  mySocketId = socket.id;
});

socket.on("welcome", (data) => {
  mySocketId = data.id;
  otherPlayers = data.players || {};
  if (data.gameArea) gameArea = data.gameArea;
  syncPlayerPoints();
});

socket.on("gameArea", (area) => {
  gameArea = area;
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
    me.update();
    me.display();
    for (let id in playerPoints) {
      playerPoints[id].update();
      playerPoints[id].display();
    }
  }
}

function touchStarted() {
  if (mapInit) {
    let pos = myMap.pixelToLatLng(touches[0].x, touches[0].y);
    console.log("TOUCHED", pos);
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function handleNewPosition(pos) {
  console.log("NEW LOC", pos);
  console.log("accuracy:", pos.coords.accuracy, "meters");
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
  const mpp = 156543.03392 * Math.cos((lat * Math.PI) / 180) / Math.pow(2, z);
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

class PlayerPoint {
  constructor(col, isMe) {
    this.x = 0;
    this.y = 0;
    this.goalX = 0;
    this.goalY = 0;
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

    // accuracy circle
    noFill();
    stroke("red");
    let diameter = 2 * metersToPixel(this.accuracy, currentLatitude);
    circle(0, 0, diameter);
    line(0, 0, diameter / 2, 0);
    fill("red");
    noStroke();
    if (mapInit) {
      textSize(map(myMap.zoom(), 9, 18, 0, 12));
    }
    text("accuracy:" + this.accuracy, diameter / 2 + 1, 0);

    // player dot
    let displayCol = this.playerColor ? color(this.playerColor) : this.col;
    fill(displayCol);
    stroke(this.isMe ? "pink" : "white");
    strokeWeight(3);
    let dia = this.size + sin(frameCount * 0.1);
    circle(0, 0, dia);

    // player name label
    if (this.playerName && mapInit) {
      noStroke();
      fill(0);
      textAlign(CENTER);
      textSize(map(myMap.zoom(), 9, 18, 0, 11));
      text(this.isMe ? "You" : this.playerName, 0, -dia / 2 - 6);
      textAlign(LEFT);
    }

    pop();
  }
}

function syncPlayerPoints() {
  let nextPoints = {};

  for (let id in otherPlayers) {
    if (id === mySocketId) continue;

    let existing = playerPoints[id];
    if (existing) {
      nextPoints[id] = existing;
      continue;
    }

    let pt = new PlayerPoint(color(170, 190, 240), false);
    nextPoints[id] = pt;
  }

  playerPoints = nextPoints;
}
