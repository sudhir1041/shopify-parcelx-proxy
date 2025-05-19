// functions/index.js
const functions = require("firebase-functions");
const express = require("express");
const fetch = require("node-fetch"); // Using node-fetch v2 for CommonJS

const app = express();

// --- Configuration - IMPORTANT: Set these in your Firebase Function's environment variables ---
// Default ParcelX API URL. Can be overridden by PARCELX_API_URL_BASE environment variable.
const PARCELX_API_URL_BASE = functions.config().parcelx?.api_url_base || 'https://app.parcelx.in/api/v1/track_order';
// ParcelX API Token. This MUST be set as an environment variable for your Firebase Function.
const PARCELX_API_TOKEN = functions.config().parcelx?.api_token;

// Middleware to parse JSON bodies (though not strictly needed for this GET route, it's good practice)
app.use(express.json());

// This is the route your Shopify App Proxy will effectively trigger.
// If your Shopify App Proxy is configured with:
// Subpath prefix: 'apps'
// Subpath: 'parceltrack'
// Proxy URL: (Your Firebase Function Trigger URL)
// Then a request from your Shopify store like:
// 'your-store.myshopify.com/apps/parceltrack?channel_order_no=123'
// will be routed by Shopify to your Firebase Function.
// The Express app will handle the '/apps/parceltrack' part of the path if the function is deployed
// to handle all requests to its base trigger URL and the Shopify Proxy URL points to that base.
// Alternatively, if the function trigger URL itself includes '/apps/parceltrack', this route becomes '/'.
// For simplicity with Shopify App Proxy, we often deploy the Express app to handle requests at the function's root.
// Shopify will forward the full path including '/apps/parceltrack'.
app.get('/apps/parceltrack', async (req, res) => {
    const orderId = req.query.channel_order_no;
    const requestTimestamp = new Date().toISOString(); // For logging

    // Set Content-Type for the response to the Shopify App Proxy.
    res.setHeader('Content-Type', 'application/json');

    // Validate that an orderId was provided
    if (!orderId) {
        console.warn(`[${requestTimestamp}] Request received without channel_order_no parameter.`);
        return res.status(400).json({ error: 'Order ID (channel_order_no) is required.' });
    }

    // Validate that the API token is configured
    if (!PARCELX_API_TOKEN) {
        console.error(`[${requestTimestamp}] FATAL: PARCELX_API_TOKEN is not configured in Firebase environment. Cannot process request for Order ID: ${orderId}.`);
        // Log how to set it: console.log("Set with: firebase functions:config:set parcelx.api_token=\"YOUR_TOKEN_HERE\"");
        return res.status(500).json({ error: 'Tracking service API token configuration error on server. Please contact support.' });
    }

    // Construct the URL for the ParcelX API
    const parcelXApiUrl = `${PARCELX_API_URL_BASE}?channel_order_no=${encodeURIComponent(orderId)}`;
    
    console.log(`[${requestTimestamp}] Firebase Function proxying request for Order ID: ${orderId}. Target URL: ${PARCELX_API_URL_BASE}`);

    try {
        // Make the actual API call to ParcelX
        const apiResponse = await fetch(parcelXApiUrl, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'access-token': PARCELX_API_TOKEN // Securely using the token from Firebase environment
            }
        });

        const responseBodyText = await apiResponse.text();
        let responseData;

        try {
            responseData = JSON.parse(responseBodyText);
        } catch (e) {
            console.error(`[${requestTimestamp}] ParcelX API response for Order ID ${orderId} was not valid JSON. Status: ${apiResponse.status}. Body (first 500 chars): ${responseBodyText.substring(0, 500)}...`);
            return res.status(apiResponse.status || 502).json({
                error: `Received an invalid response from the upstream tracking service. Status: ${apiResponse.status}`,
            });
        }
        
        console.log(`[${requestTimestamp}] Response from ParcelX for Order ID ${orderId} - Status: ${apiResponse.status}`);
        return res.status(apiResponse.status).json(responseData);

    } catch (error) {
        console.error(`[${requestTimestamp}] Error calling ParcelX API for Order ID ${orderId}: ${error.message}`);
        return res.status(503).json({ error: 'Service Unavailable. Failed to connect to the tracking service via proxy.' });
    }
});

// Optional: A basic health check endpoint
// If your function trigger URL is '.../shopifyParcelXProxy', then this would be '.../shopifyParcelXProxy/health'
// if the Express app handles all routes from the function's base.
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok', 
        message: 'Firebase ParcelX Proxy Function is running',
        timestamp: new Date().toISOString() 
    });
});


// Expose the Express app as an HTTP-triggered Firebase Function.
// The name 'shopifyParcelXProxy' will be part of the function's trigger URL.
exports.shopifyParcelXProxy = functions.https.onRequest(app);
