// This file serves as the entry point for Vercel serverless functions
// It redirects all API requests to our main Express application

// Import the compiled Express app
const app = require('../dist/app.js').default;

// Export a handler for Vercel to use
module.exports = app; 