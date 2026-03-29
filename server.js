const express = require("express");
const https = require("https");
const fs = require("fs");
const app = express();
const portHTTPS = 3010;

app.use(express.static("public"));

const options = {
  key: fs.readFileSync("localhost-key.pem"),
  cert: fs.readFileSync("localhost.pem"),
};

let HTTPSserver = https.createServer(options, app);

const { Server } = require("socket.io");
const io = new Server(HTTPSserver);

let currentlyConnected = [];
let players = {};
let gameArea = null;
let readyPlayers = {};
let gameStarted = false;
let hunterId = null;
let hunterCircles = [];
let scores = {};
let scoreInterval = null;
let lastCirclePlacedAt = 0;

let scoringConfig = {
  hunterPointsPerPlayerInCircle: 10,
  survivorProximityMaxDistance: 100,
  survivorProximityMaxPoints: 5,
  survivorProximityFormula: "linear",
  hunterCircleRadius: 30,
  maxHunterCircles: 3,
  scoreTickMs: 1000,
  hunterCircleCooldownMs: 60000,
};

function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calcSurvivorProximityPoints(dist) {
  const cfg = scoringConfig;
  if (dist >= cfg.survivorProximityMaxDistance) return 0;
  const ratio = 1 - dist / cfg.survivorProximityMaxDistance;
  if (cfg.survivorProximityFormula === "quadratic")
    return cfg.survivorProximityMaxPoints * ratio * ratio;
  if (cfg.survivorProximityFormula === "exponential")
    return (cfg.survivorProximityMaxPoints * (Math.exp(ratio * 3) - 1)) / (Math.exp(3) - 1);
  return cfg.survivorProximityMaxPoints * ratio;
}

function scoreTick() {
  if (!gameStarted) return;

  let survivors = Object.values(players).filter((p) => p.role === "survivor");
  let inCircleMap = {};

  for (let s of survivors) {
    inCircleMap[s.id] = false;
    for (let circ of hunterCircles) {
      let d = distanceMeters(s.latitude, s.longitude, circ.latitude, circ.longitude);
      if (d <= circ.radius) {
        scores[hunterId] = (scores[hunterId] || 0) + scoringConfig.hunterPointsPerPlayerInCircle;
        inCircleMap[s.id] = true;
      }
    }
  }

  for (let i = 0; i < survivors.length; i++) {
    for (let j = i + 1; j < survivors.length; j++) {
      let d = distanceMeters(
        survivors[i].latitude,
        survivors[i].longitude,
        survivors[j].latitude,
        survivors[j].longitude,
      );
      let pts = calcSurvivorProximityPoints(d);
      if (pts > 0) {
        scores[survivors[i].id] = (scores[survivors[i].id] || 0) + pts;
        scores[survivors[j].id] = (scores[survivors[j].id] || 0) + pts;
      }
    }
  }

  io.emit("scores", scores);
  for (let s of survivors) {
    io.to(s.id).emit("inCircle", inCircleMap[s.id]);
  }
}

io.on("connection", (socket) => {
  console.log("player connected", socket.id);
  currentlyConnected.push(socket.id);

  // assign a random color to new player
  const hue = Math.floor(Math.random() * 360);
  players[socket.id] = {
    id: socket.id,
    latitude: 0,
    longitude: 0,
    accuracy: 0,
    name: "Player " + socket.id.substring(0, 4),
    color: `hsl(${hue}, 70%, 60%)`,
  };

  // send current state to the new player
  let welcomeData = {
    id: socket.id,
    players: players,
    gameArea: gameArea,
    readyPlayers: readyPlayers,
    gameStarted: gameStarted,
    hunterId: hunterId,
    scores: scores,
  };
  if (socket.id === hunterId) {
    welcomeData.hunterCircles = hunterCircles;
    welcomeData.nextPlaceAt = lastCirclePlacedAt + scoringConfig.hunterCircleCooldownMs;
  }
  socket.emit("welcome", welcomeData);

  // notify everyone about the new player
  io.emit("players", players);

  socket.on("updateLocation", (data) => {
    if (!data || typeof data.latitude !== "number" || typeof data.longitude !== "number") {
      return;
    }

    if (!gameArea) {
      const lat = data.latitude;
      const lng = data.longitude;
      const latOffset = 250 / 111320;
      const lngOffset = 250 / (111320 * Math.cos((lat * Math.PI) / 180));

      gameArea = {
        center: { latitude: lat, longitude: lng },
        north: lat + latOffset,
        south: lat - latOffset,
        east: lng + lngOffset,
        west: lng - lngOffset,
      };
      console.log("Game area set:", gameArea);
      io.emit("gameArea", gameArea);
    }

    if (players[socket.id]) {
      players[socket.id].latitude = data.latitude;
      players[socket.id].longitude = data.longitude;
      players[socket.id].accuracy = typeof data.accuracy === "number" ? data.accuracy : 0;
    }

    io.emit("players", players);
  });

  socket.on("ready", () => {
    if (gameStarted) return;
    readyPlayers[socket.id] = true;
    io.emit("readyPlayers", readyPlayers);

    let allReady =
      currentlyConnected.length > 0 && currentlyConnected.every((id) => readyPlayers[id]);
    if (allReady) {
      gameStarted = true;
      hunterId = currentlyConnected[Math.floor(Math.random() * currentlyConnected.length)];
      players[hunterId].role = "hunter";
      for (let id of currentlyConnected) {
        if (id !== hunterId) players[id].role = "survivor";
      }
      for (let id of currentlyConnected) scores[id] = 0;
      io.emit("gameStart", { hunterId: hunterId });
      io.emit("players", players);
      scoreInterval = setInterval(scoreTick, scoringConfig.scoreTickMs);
      console.log("Game started! Hunter:", hunterId);
    }
  });

  socket.on("placeCircle", (data) => {
    if (socket.id !== hunterId || !gameStarted) return;
    if (!data || typeof data.latitude !== "number" || typeof data.longitude !== "number") return;
    let now = Date.now();
    if (now - lastCirclePlacedAt < scoringConfig.hunterCircleCooldownMs) {
      socket.emit("cooldownReject", {
        nextPlaceAt: lastCirclePlacedAt + scoringConfig.hunterCircleCooldownMs,
      });
      return;
    }
    if (hunterCircles.length >= scoringConfig.maxHunterCircles) {
      hunterCircles.shift();
    }
    hunterCircles.push({
      latitude: data.latitude,
      longitude: data.longitude,
      radius: scoringConfig.hunterCircleRadius,
    });
    lastCirclePlacedAt = now;
    io.to(hunterId).emit("hunterCircles", hunterCircles);
    io.to(hunterId).emit("cooldownStart", {
      nextPlaceAt: lastCirclePlacedAt + scoringConfig.hunterCircleCooldownMs,
    });
  });

  socket.on("setName", (name) => {
    if (players[socket.id] && typeof name === "string") {
      players[socket.id].name = name.substring(0, 20);
      io.emit("players", players);
    }
  });

  socket.on("disconnect", () => {
    console.log("player disconnected", socket.id);

    let idx = currentlyConnected.indexOf(socket.id);
    if (idx > -1) {
      currentlyConnected.splice(idx, 1);
    }

    delete players[socket.id];
    delete readyPlayers[socket.id];
    io.emit("players", players);
    io.emit("readyPlayers", readyPlayers);
  });
});

HTTPSserver.listen(portHTTPS, () => {
  console.log("Map Hunter Game - HTTPS Server started at port", portHTTPS);
});
