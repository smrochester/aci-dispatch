// api/claude-dispatch.js
// Proxy Claude API dispatch generation requests

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { apiKey, prompt } = req.body;

  if (!apiKey || !prompt) {
    return res.status(400).json({
      error: 'Missing apiKey or prompt'
    });
  }

  try {
    console.log('[Claude Proxy] Calling Claude API with prompt length:', prompt.length);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-20250514',
        max_tokens: 3000,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    });

    console.log('[Claude Proxy] Response status:', response.status);

    const data = await response.json();

    if (!response.ok) {
      console.error('[Claude Proxy] Error response:', data);
      return res.status(response.status).json({
        error: 'Claude API error',
        details: data
      });
    }

    console.log('[Claude Proxy] Success');
    return res.status(200).json({
      success: true,
      data: data
    });
  } catch (error) {
    console.error('[Claude Proxy] Fetch error:', error);
    return res.status(500).json({
      error: 'Failed to call Claude API',
      message: error.message
    });
  }
}
