const mongoose = require('mongoose');
const PushTicketSchema = new mongoose.Schema({
  ticketId: { type: String, required: true, unique: true },
  token: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('PushTicket', PushTicketSchema);