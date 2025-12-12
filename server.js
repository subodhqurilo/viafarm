/// server.js
require("dotenv").config();     // ← MUST BE FIRST LINE, DO NOT MOVE

const express = require("express");
const connectDB = require("./config/db");
const path = require("path");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const cookieParser = require("cookie-parser");
const { Expo } = require("expo-server-sdk");

// CONNECT DATABASE (after .env loaded)
connectDB();

// EXPRESS APP
const app = express();
app.use(cookieParser());

// View Engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Expo instance (single instance)
const expo = new Expo();

// --- CORS ---
app.use(
  cors({
    origin: [
      "https://viafarm-iy5q.vercel.app",
      "https://viafarm-e3tc.vercel.app",
      "https://viafarm-1.onrender.com",
      "http://localhost:3000",
      "http://192.168.1.5:8081",
      "exp://192.168.1.5:8081",
      process.env.FRONTEND_URL,
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// HTTP Server
const server = http.createServer(app);

// --- SOCKET.IO ---
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// ===== ONLINE USERS MEMORY STORE =====
const onlineUsers = {};

// --- SOCKET EVENTS ---
io.on("connection", (socket) => {
  console.log("⚡ User connected:", socket.id);

  socket.on("registerUser", ({ userId, role }) => {
    if (userId) {
      onlineUsers[userId] = { socketId: socket.id, role };
      console.log(`🟢 ${role} connected → ID: ${userId}`);
    }
  });

  socket.on("disconnect", () => {
    for (const [id, info] of Object.entries(onlineUsers)) {
      if (info.socketId === socket.id) {
        console.log(`🔴 Disconnected → ${info.role}: ${id}`);
        delete onlineUsers[id];
        break;
      }
    }
  });
});

// --- MAKE io & expo available to controllers ---
app.set("io", io);
app.set("expo", expo);
app.set("onlineUsers", onlineUsers);

// GLOBAL ACCESS
global.io = io;
global.expo = expo;
global.onlineUsers = onlineUsers;




app.use((req, res, next) => {
  console.log("🔥 FULL REQUEST URL:", req.originalUrl);
  console.log("🔥 QUERY RECEIVED:", req.query);
  next();
});

// ROUTES
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/buyer", require("./routes/buyerRoutes"));
app.use("/api/vendor", require("./routes/vendorRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/notifications", require("./routes/notificationRoutes"));
app.use("/", require("./routes/resetRoutes"));
app.use("/api", require("./routes/testRoutes"));
// app.use("/api/push", require("./routes/push"));
app.use((err, req, res, next) => {
  console.error("🔥 GLOBAL ERROR:", err.stack);
  res.status(500).json({ success: false, message: err.message });
});


// DEFAULT
app.get("/", (req, res) => res.send("🚀 ViaFarm API running successfully!"));

// START SERVER
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
