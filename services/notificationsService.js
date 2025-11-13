const { Expo } = require('expo-server-sdk');
const expo = new Expo();
/**
 * messages: array of { to, title, body, data, sound }
 * returns tickets array (expo ticket objects)
 */
async function sendNotifications(messages) {
  const chunks = expo.chunkPushNotifications(messages);
  const tickets = [];
  for (const chunk of chunks) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
    } catch (err) {
      console.error('Error sending push chunk', err);
      // continue
    }
  }
  return tickets;
}
/**
 * ticketIds: array of ticket ids
 * returns receipts map { ticketId: receipt }
 */
async function getReceipts(ticketIds) {
  try {
    const receipts = await expo.getPushNotificationReceiptsAsync(ticketIds);
    return receipts;
  } catch (err) {
    console.error('getReceipts error', err);
    return null;
  }
}
module.exports = { sendNotifications, getReceipts };







