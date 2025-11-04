// server.js
const express = require('express');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const path = require('path');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { Expo } = require('expo-server-sdk');

dotenv.config();
connectDB();

const app = express();
// ✅ View Engine Setup for Password Reset Page
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ✅ Initialize Expo Push SDK (for React Native app)
const expo = new Expo();

// ✅ CORS Setup — for Web & Expo App
app.use(cors({
  origin: [
    "http://localhost:3000",   // Web (Admin Panel)
    "http://192.168.1.5:8081", // Expo Dev (replace IP)
    "exp://192.168.1.5:8081"   // Expo App (replace IP)
  ],
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));

app.use(express.json());

// ✅ Create HTTP Server for Socket.IO
const server = http.createServer(app);

// ✅ Initialize Socket.IO
const io = new Server(server, {
  cors: {
    origin: "*", // during dev, open. In prod, restrict to your domains.
    methods: ["GET", "POST"]
  }
});

// 🟢 Online Users Memory Store
let onlineUsers = {};

// ✅ Socket.IO Setup
io.on('connection', (socket) => {
  // console.log('⚡ User connected:', socket.id);

  // 🧩 When a user registers their connection
  socket.on('registerUser', ({ userId, role }) => {
    if (userId) {
      onlineUsers[userId] = { socketId: socket.id, role };
      console.log(`✅ ${role} connected: ${userId}`);
    }
  });

  // ❌ When user disconnects
  socket.on('disconnect', () => {
    for (const [userId, info] of Object.entries(onlineUsers)) {
      if (info.socketId === socket.id) {
        console.log(`❌ ${info.role} disconnected: ${userId}`);
        delete onlineUsers[userId];
        break;
      }
    }
  });
});

// ✅ Attach `io`, `expo`, and `onlineUsers` to app (accessible in controllers)
app.set('io', io);
app.set('expo', expo);
app.set('onlineUsers', onlineUsers);

// ✅ Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/buyer', require('./routes/buyerRoutes'));
app.use('/api/vendor', require('./routes/vendorRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/', require('./routes/resetRoutes'));

// ✅ Default route
app.get('/', (req, res) => res.send('API running...'));

// ✅ Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
