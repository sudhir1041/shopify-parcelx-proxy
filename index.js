// index.js
// This file contains the Express server logic for your Shopify App Proxy.
// Ensure your hosting service (e.g., Render.com) is configured to run this file
// (e.g., Start Command: node index.js or npm start if package.json points here).

const express = require('express');
const fetch = require('node-fetch'); // Using node-fetch v2 for CommonJS
const cors = require('cors'); // Import the CORS middleware

const app = express();

// Render.com (or your hosting provider) provides the PORT environment variable
// The server must listen on the port your hosting provider assigns via process.env.PORT
const PORT = process.env.PORT || 3000; // Default to 3000 for local testing if PORT isn't set

// --- Configuration - IMPORTANT: Set these in your hosting environment variables ---
// Default ParcelX API URL. Can be overridden by PARCELX_API_URL_BASE environment variable.
const PARCELX_API_URL_BASE = process.env.PARCELX_API_URL_BASE || 'https://app.parcelx.in/api/v1/track_order';
// ParcelX API Token. This MUST be set as an environment variable on your hosting server.
const PARCELX_API_TOKEN = process.env.PARCELX_API_TOKEN;

// --- CORS Configuration ---
// If you are calling this proxy server's URL directly from your Shopify theme's JavaScript
// (i.e., not using the Shopify App Proxy relative path /apps/parceltrack),
// you MUST enable CORS on this server.

// Option 1: Allow all origins (less secure, good for initial testing if needed)
// app.use(cors());

// Option 2: Allow specific origins (RECOMMENDED for production if calling directly)
// Replace 'https://your-store-name.myshopify.com' and 'https://your-custom-domain.com'
// with your actual Shopify store domains.
const whitelist = [
    `https://${process.env.SHOPIFY_SHOP_DOMAIN}`, // Dynamically get from Shopify if app, or hardcode
    'https://your-store-name.myshopify.com',      // Example: your primary *.myshopify.com domain
    'https://www.yourcustomdomain.com'             // Example: your custom domain
];
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, or server-to-server)
    // OR if the origin is in the whitelist
    if (!origin || whitelist.indexOf(origin) !== -1 || (process.env.NODE_ENV === 'development' && origin && origin.startsWith('http://localhost:'))) {
      callback(null, true);
    } else {
      console.warn(`CORS: Denied request from origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  }
};
app.use(cors(corsOptions)); // Use the configured CORS options

// Middleware to parse JSON bodies (though not strictly needed for this GET route, it's good practice)
app.use(express.json());

// This is the route your Shopify App Proxy will forward requests to,
// OR the route your theme's JavaScript will call directly if using the full URL.
// Example: Shopify App Proxy Subpath 'parceltrack' -> your-render-url.com/apps/parceltrack
// OR Direct call from theme: https://your-render-url.com/apps/parceltrack
app.get('/apps/parceltrack', async (req, res) => {
    const orderId = req.query.channel_order_no;
    const requestTimestamp = new Date().toISOString(); // For logging

    // Set Content-Type for the response.
    res.setHeader('Content-Type', 'application/json');

    // Validate that an orderId was provided in the query parameters
    if (!orderId) {
        console.warn(`[${requestTimestamp}] Request received without 'channel_order_no' parameter.`);
        return res.status(400).json({ error: "Order ID (channel_order_no) is required." });
    }

    // Validate that the API token is configured on the server via environment variables
    if (!PARCELX_API_TOKEN) {
        console.error(`[${requestTimestamp}] FATAL: PARCELX_API_TOKEN is not configured on the server. Cannot process request for Order ID: ${orderId}.`);
        return res.status(500).json({ error: "Tracking service API token configuration error on server. Please contact support." });
    }

    // Construct the URL for the external ParcelX API
    const parcelXApiUrl = `${PARCELX_API_URL_BASE}?channel_order_no=${encodeURIComponent(orderId)}`;
    
    console.log(`[${requestTimestamp}] Proxying request for Order ID: ${orderId}. Target URL: ${PARCELX_API_URL_BASE}`);

    try {
        // Make the actual API call to ParcelX
        const apiResponse = await fetch(parcelXApiUrl, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'access-token': PARCELX_API_TOKEN // Securely using the token from server's environment
            }
        });

        // Get the response body as text first to handle potential non-JSON error responses from ParcelX
        const responseBodyText = await apiResponse.text();
        let responseData;

        try {
            // Attempt to parse the response body as JSON
            responseData = JSON.parse(responseBodyText);
        } catch (e) {
            // If JSON parsing fails, the response from ParcelX was not valid JSON
            console.error(`[${requestTimestamp}] ParcelX API response for Order ID ${orderId} was not valid JSON. Status: ${apiResponse.status}. Body (first 500 chars): ${responseBodyText.substring(0, 500)}...`);
            // Return a 502 Bad Gateway error, as the proxy received an invalid response from upstream
            return res.status(apiResponse.status || 502).json({
                error: `Received an invalid response from the upstream tracking service. Status: ${apiResponse.status}`,
            });
        }
        
        // Log the status of the response from ParcelX
        console.log(`[${requestTimestamp}] Response from ParcelX for Order ID ${orderId} - Status: ${apiResponse.status}`);
        
        // Forward the status and the parsed JSON data from ParcelX back to the client
        return res.status(apiResponse.status).json(responseData);

    } catch (error) {
        // Handle network errors or other issues when trying to reach the ParcelX API
        console.error(`[${requestTimestamp}] Error calling ParcelX API for Order ID ${orderId}: ${error.message}`);
        // Return a 503 Service Unavailable error
        return res.status(503).json({ error: "Service Unavailable. Failed to connect to the tracking service via proxy." });
    }
});

// Optional: A basic health check endpoint for your proxy server
// This helps verify that your Express app is running correctly.
// You can access this at https://your-render-app-name.onrender.com/health
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok', 
        message: 'ParcelX Proxy is running',
        timestamp: new Date().toISOString() 
    });
});

// Start the server and listen on the port provided by your hosting service (or 3000 locally)
app.listen(PORT, () => {
    console.log(`Shopify ParcelX Proxy Server running on port ${PORT}`);
    // Startup check for the essential API token
    if (!process.env.PARCELX_API_TOKEN) {
        console.warn("WARNING: PARCELX_API_TOKEN environment variable is NOT SET. The proxy will not be able to authenticate with ParcelX.");
    }
    // Info about the API base URL being used
    if (!process.env.PARCELX_API_URL_BASE) {
        console.info(`INFO: PARCELX_API_URL_BASE environment variable is not set. Using default: ${PARCELX_API_URL_BASE}`);
    }
});
