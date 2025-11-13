/// server.js
const express = require("express");
const dotenv = require("dotenv");
const connectDB = require("./config/db");
const path = require("path");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const { Expo } = require("expo-server-sdk");
const cookieParser = require("cookie-parser");

dotenv.config();
connectDB();

const app = express();
app.use(cookieParser());

// 🔥 Allowed frontend origins
const allowedOrigins = [
  "https://viafarm-e3tc.vercel.app",    // your admin vercel build
  "http://localhost:3000",             // local dev admin
  "http://192.168.1.5:8081",           // expo LAN
  "exp://192.168.1.5:8081",
  process.env.FRONTEND_URL,
];

// ------------------
// CORS CONFIG
// ------------------
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true); // allow mobile app/expo
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("CORS blocked origin: " + origin), false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ------------------
// EJS ENGINE
// ------------------
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ------------------
// EXPO SDK
// ------------------
const expo = new Expo();

// ------------------
// HTTP + SOCKET.IO
// ------------------
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "POST"],
  },
});

// ------------------
// SOCKET USER TRACKING
// ------------------
let onlineUsers = {};

io.on("connection", (socket) => {
  console.log("⚡ User connected:", socket.id);

  socket.on("registerUser", ({ userId, role }) => {
    if (userId) {
      onlineUsers[userId] = { socketId: socket.id, role };
      console.log(`🔵 ${role} connected: ${userId}`);
    }
  });

  socket.on("disconnect", () => {
    for (const [id, info] of Object.entries(onlineUsers)) {
      if (info.socketId === socket.id) {
        console.log(`🔴 ${info.role} disconnected: ${id}`);
        delete onlineUsers[id];
        break;
      }
    }
  });
});

// ------------------
// GLOBAL REFS
// ------------------
app.set("io", io);
app.set("expo", expo);
app.set("onlineUsers", onlineUsers);

global.io = io;
global.expo = expo;
global.onlineUsers = onlineUsers;

// ------------------
// ROUTES
// ------------------
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/buyer", require("./routes/buyerRoutes"));
app.use("/api/vendor", require("./routes/vendorRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/notifications", require("./routes/notificationRoutes"));
app.use("/", require("./routes/resetRoutes"));
app.use("/api", require("./routes/testRoutes"));

// ------------------
// DEFAULT
// ------------------
app.get("/", (req, res) =>
  res.send("🚀 ViaFarm API running successfully!")
);

// ------------------
// START SERVER
// ------------------
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
