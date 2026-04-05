// api/housecall-pro.js
// Serverless function to proxy HouseCall Pro API calls
// Solves CORS issues by making requests from backend instead of browser

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { endpoint, apiKey, params = {} } = req.body;

  if (!endpoint || !apiKey) {
    res.status(400).json({
      error: 'Missing endpoint or apiKey',
      received: { endpoint: !!endpoint, apiKey: !!apiKey }
    });
    return;
  }

  try {
    // Build query string from params
    const queryParams = new URLSearchParams(params);
    const fullUrl = `https://api.housecallpro.com/${endpoint}${queryParams.toString() ? '?' + queryParams.toString() : ''}`;

    console.log(`[HCP Proxy] Calling: ${fullUrl}`);
    console.log(`[HCP Proxy] API Key format: ${apiKey.substring(0, 10)}...`);

    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      }
    });

    console.log(`[HCP Proxy] Response status: ${response.status}, Content-Type: ${response.headers.get('content-type')}`);

    const responseText = await response.text();
    
    // Try to parse as JSON
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      // If not JSON, return the raw response for debugging
      console.error(`[HCP Proxy] Response is not JSON. First 500 chars:`, responseText.substring(0, 500));
      res.status(response.status).json({
        error: `HouseCall Pro returned non-JSON response (${response.status})`,
        contentType: response.headers.get('content-type'),
        responsePreview: responseText.substring(0, 500),
        possibleIssues: [
          'Invalid or expired API key',
          'API key lacks permissions',
          'Wrong endpoint or account',
          'HouseCall Pro service issue'
        ]
      });
      return;
    }

    if (!response.ok) {
      console.log(`[HCP Proxy] Error response: ${response.status}`, data);
      res.status(response.status).json({
        error: `HouseCall Pro API error: ${response.status}`,
        details: data
      });
      return;
    }

    console.log(`[HCP Proxy] Success: ${endpoint}`);
    res.status(200).json({
      success: true,
      data: data
    });
  } catch (error) {
    console.error('[HCP Proxy] Fetch error:', error);
    res.status(500).json({
      error: 'Failed to fetch from HouseCall Pro',
      message: error.message,
      type: error.constructor.name
    });
  }
}
