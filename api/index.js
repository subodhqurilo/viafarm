const serverless = require('serverless-http');
const app = require('../server'); // Import your Express app

module.exports = serverless(app);
