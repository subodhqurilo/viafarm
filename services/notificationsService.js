// utils/expoPush.js
const { Expo } = require('expo-server-sdk');
const expo = new Expo();

/**
 * Send notification messages to Expo
 * @param {Array} messages  --> [{ to, sound, title, body, data }]
 * @returns {Array} tickets --> [{ status, id, ... }]
 */
async function sendNotifications(messages) {
  const chunks = expo.chunkPushNotifications(messages);
  const tickets = [];

  for (const chunk of chunks) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
    } catch (err) {
      console.error("Expo push error (chunk):", err);
    }
  }

  return tickets;
}

/**
 * Fetch receipts for previously sent tickets
 * @param {Array} ticketIds
 * @returns receipts object
 */
async function getReceipts(ticketIds) {
  try {
    const receipts = await expo.getPushNotificationReceiptsAsync(ticketIds);
    return receipts;
  } catch (err) {
    console.error("getReceipts error:", err);
    return null;
  }
}

module.exports = { sendNotifications, getReceipts };
