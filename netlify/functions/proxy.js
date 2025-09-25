const DEFAULT_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

const createResponse = (statusCode, body, extraHeaders = {}) => ({
  statusCode,
  headers: {
    ...DEFAULT_HEADERS,
    ...extraHeaders
  },
  body
});

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return createResponse(204, '');
  }

  const targetUrl = event.queryStringParameters?.url;

  if (!targetUrl) {
    return createResponse(400, JSON.stringify({ error: 'Missing `url` query parameter.' }), {
      'Content-Type': 'application/json'
    });
  }

  try {
    const upstreamResponse = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json, text/plain, */*'
      }
    });

    const buffer = Buffer.from(await upstreamResponse.arrayBuffer());
    const isBinary = !/^text\//i.test(upstreamResponse.headers.get('content-type') || '') &&
      !(upstreamResponse.headers.get('content-type') || '').includes('json');

    return {
      statusCode: upstreamResponse.status,
      headers: {
        ...DEFAULT_HEADERS,
        'Content-Type': upstreamResponse.headers.get('content-type') || 'application/octet-stream',
        'Cache-Control': upstreamResponse.headers.get('cache-control') || 'no-store'
      },
      body: isBinary ? buffer.toString('base64') : buffer.toString('utf8'),
      isBase64Encoded: isBinary
    };
  } catch (error) {
    console.error('Proxy request failed', error);
    return createResponse(502, JSON.stringify({ error: 'Proxy failed to fetch remote resource.' }), {
      'Content-Type': 'application/json'
    });
  }
};
