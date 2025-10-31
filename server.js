// server.js
const express = require('express');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

dotenv.config();
connectDB();

const app = express();

app.use(cors({
  origin: "http://localhost:3000", // during testing; later replace with your actual URLs
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "http://localhost:3000", methods: ["GET", "POST"] }
});

// 🟢 Store online users
let onlineUsers = {};

io.on('connection', (socket) => {
  console.log('🔌 User connected:', socket.id);

  // When user joins (frontend should send userId + role)
  socket.on('registerUser', ({ userId, role }) => {
    if (userId) {
      onlineUsers[userId] = { socketId: socket.id, role };
      console.log(`✅ ${role} registered: ${userId}`);
    }
  });

  // When user disconnects
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

// Make io & users map available globally
app.set('io', io);
app.set('onlineUsers', onlineUsers);

// Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/buyer', require('./routes/buyerRoutes'));
app.use('/api/vendor', require('./routes/vendorRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));

app.get('/', (req, res) => res.send('API running...'));

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
