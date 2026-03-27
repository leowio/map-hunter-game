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
let players = {}; // all player state: location, name, color

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
  socket.emit("welcome", { id: socket.id, players: players });

  // notify everyone about the new player
  io.emit("players", players);

  socket.on("updateLocation", (data) => {
    if (!data || typeof data.latitude !== "number" || typeof data.longitude !== "number") {
      return;
    }

    if (players[socket.id]) {
      players[socket.id].latitude = data.latitude;
      players[socket.id].longitude = data.longitude;
      players[socket.id].accuracy = typeof data.accuracy === "number" ? data.accuracy : 0;
    }

    io.emit("players", players);
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
    io.emit("players", players);
  });
});

HTTPSserver.listen(portHTTPS, () => {
  console.log("Map Hunter Game - HTTPS Server started at port", portHTTPS);
});
