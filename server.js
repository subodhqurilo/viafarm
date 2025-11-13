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

// ✅ View Engine (used for password reset page etc.)
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ✅ Initialize Expo SDK (for mobile push)
const expo = new Expo();

// ✅ CORS — Allow frontend + mobile Expo dev client
app.use(
  cors({
    origin: [
      "https://viafarm-iy5q.vercel.app",
      "https://viafarm-e3tc.vercel.app",
      "https://viafarm-1.onrender.com",
      "http://localhost:3000", // Admin Panel (local)
      "http://192.168.1.5:8081", // Replace with your LAN IP for Expo Dev
      "exp://192.168.1.5:8081",  // Expo Go dev client
      process.env.FRONTEND_URL,
    ],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ Create HTTP server
const server = http.createServer(app);

// ✅ Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: "*", // ⚠️ in dev allow all, restrict in prod
    methods: ["GET", "POST"],
  },
});

// 🟢 In-memory online users
let onlineUsers = {};

// ✅ Socket.IO setup
io.on("connection", (socket) => {
  console.log("⚡ User connected:", socket.id);

  // 🔹 Register user connection
  socket.on("registerUser", ({ userId, role }) => {
    if (userId) {
      onlineUsers[userId] = { socketId: socket.id, role };
      console.log(`✅ ${role} connected: ${userId}`);
    }
  });

  // 🔹 Disconnect handling
  socket.on("disconnect", () => {
    for (const [id, info] of Object.entries(onlineUsers)) {
      if (info.socketId === socket.id) {
        console.log(`❌ ${info.role} disconnected: ${id}`);
        delete onlineUsers[id];
        break;
      }
    }
  });
});

// ✅ Attach Socket.IO and Expo globally (accessible in all controllers)
app.set("io", io);
app.set("expo", expo);
app.set("onlineUsers", onlineUsers);

// 🌍 Also make globally available (for utils)
global.io = io;
global.expo = expo;
global.onlineUsers = onlineUsers;

// ✅ API Routes
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/buyer", require("./routes/buyerRoutes"));
app.use("/api/vendor", require("./routes/vendorRoutes"));
app.use("/api/admin", require("./routes/adminRoutes"));
app.use("/api/notifications", require("./routes/notificationRoutes"));
app.use("/", require("./routes/resetRoutes"));
app.use("/api", require("./routes/testRoutes"));

// ✅ Default route
app.get("/", (req, res) => res.send("🚀 ViaFarm API running successfully!"));

// ✅ Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
