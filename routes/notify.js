const express = require('express');
const router = express.Router();
const PushToken = require('../models/PushToken');
const PushTicket = require('../models/PushTicket');
const { sendNotifications, getReceipts } = require('../services/notificationsService');
const { authenticate } = require('../middleware/auth');
/**
 * POST /api/notify/order-shipped
 * body: { userId, orderId, title?, body? }
 */
router.post('/order-shipped', authenticate, async (req, res) => {
  try {
    const { userId, orderId, title, body } = req.body;
    if (!userId || !orderId) return res.status(400).json({ error: 'userId and orderId required' });
    // fetch tokens for that user
    const tokens = await PushToken.find({ userId }).lean();
    if (!tokens.length) return res.json({ sent: 0, message: 'no tokens' });
    const messages = tokens.map(t => ({
      to: t.token,
      sound: 'default',
      title: title || 'Order Shipped',
      body: body || `Your order ${orderId} has been shipped.`,
      data: { type: 'order', orderId }
    }));
    const tickets = await sendNotifications(messages);
    // tickets can be array with elements: { status: 'ok', id:'...', ... } or { status:'error', message:'...' }
    const ticketIds = [];
    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      // Only when ticket.id is present we can track receipts
      if (ticket && ticket.id) {
        ticketIds.push(ticket.id);
        // Map ticket id to token: note messages map to tokens by index (Expo preserves order)
        const token = messages[i].to;
        try {
          await PushTicket.findOneAndUpdate(
            { ticketId: ticket.id },
            { ticketId: ticket.id, token },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
        } catch (err) {
          console.warn('Failed to store ticket mapping', ticket.id, err);
        }
      } else if (ticket && ticket.status === 'error') {
        console.warn('Ticket error', ticket);
      }
    }
    res.json({ sent: messages.length, tickets, ticketIds });
  } catch (err) {
    console.error('notify/order-shipped error', err);
    res.status(500).json({ error: 'server error' });
  }
});
/**
 * POST /api/notify/process-receipts
 * Optional body: { minutesAgo: number } to process ticketIds older than X minutes
 *
 * This endpoint fetches stored ticket mappings, queries receipts and removes tokens with DeviceNotRegistered.
 */
router.post('/process-receipts', async (req, res) => {
  try {
    // find ticket mappings older than X minutes (default 10)
    const minutes = Number(req.body?.minutesAgo) || 10;
    const since = new Date(Date.now() - minutes * 60 * 1000);
    const ticketDocs = await PushTicket.find({ createdAt: { $lte: new Date() } }).lean(); // get all; you can filter by createdAt if desired
    const ticketIds = ticketDocs.map(d => d.ticketId).filter(Boolean);
    if (!ticketIds.length) return res.json({ processed: 0, message: 'no ticketIds' });
    const receipts = await getReceipts(ticketIds);
    const removed = [];
    for (const [ticketId, receipt] of Object.entries(receipts || {})) {
      if (receipt.status === 'error') {
        const err = receipt.details && receipt.details.error;
        if (err === 'DeviceNotRegistered') {
          // find token from PushTicket and delete token
          const mapping = ticketDocs.find(t => t.ticketId === ticketId);
          if (mapping) {
            try {
              await PushToken.deleteOne({ token: mapping.token });
              removed.push(mapping.token);
            } catch (err) {
              console.warn('Failed to remove token', mapping.token, err);
            }
          }
        } else {
          console.warn('Receipt error for ticket', ticketId, receipt);
        }
      }
      // cleanup PushTicket mapping after processing
      try {
        await PushTicket.deleteOne({ ticketId });
      } catch (err) {
        console.warn('Failed delete PushTicket', ticketId, err);
      }
    }
    res.json({ processed: ticketIds.length, removed });
  } catch (err) {
    console.error('process-receipts error', err);
    res.status(500).json({ error: 'server error' });
  }
});
module.exports = router;










