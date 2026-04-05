// api/test-hcp.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { apiKey } = req.body;

  if (!apiKey) {
    return res.status(400).json({ error: 'No API key provided' });
  }

  try {
    console.log(`[TEST] Testing API key: ${apiKey.substring(0, 10)}...`);
    
    const url = 'https://api.housecallpro.com/v2/team_members?limit=1';
    console.log(`[TEST] Calling: ${url}`);

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      }
    });

    console.log(`[TEST] Status: ${response.status}`);
    console.log(`[TEST] Status Text: ${response.statusText}`);
    console.log(`[TEST] Content-Type: ${response.headers.get('content-type')}`);

    const responseText = await response.text();
    console.log(`[TEST] Response length: ${responseText.length}`);
    console.log(`[TEST] Response first 300 chars:`, responseText.substring(0, 300));

    const isJson = responseText.trim().startsWith('{') || responseText.trim().startsWith('[');
    const isHtml = responseText.trim().startsWith('<');

    return res.status(200).json({
      success: response.ok,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get('content-type'),
      responseLength: responseText.length,
      isJson,
      isHtml,
      responsePreview: responseText.substring(0, 1000),
      diagnosis: getDiagnosis(response.status, isJson, isHtml, responseText)
    });
  } catch (error) {
    console.error('[TEST] Error:', error);
    return res.status(500).json({
      error: error.message,
      type: error.constructor.name
    });
  }
}

function getDiagnosis(status, isJson, isHtml, response) {
  if (status === 200 && isJson) return '✅ API key is valid!';
  if (status === 401) return '❌ 401 Unauthorized - API key is invalid or expired';
  if (status === 403) return '❌ 403 Forbidden - API key lacks permissions';
  if (status === 404) return '❌ 404 Not Found - Wrong endpoint or HouseCall Pro account issue';
  if (status === 500) return '❌ 500 Server Error - HouseCall Pro service issue';
  if (isHtml) return `❌ Returned HTML (status ${status}) - Likely authentication error`;
  if (!isJson) return `❌ Returned non-JSON (status ${status}) - Possible firewall/proxy issue`;
  return `⚠️ Status ${status} - Check response preview`;
}
