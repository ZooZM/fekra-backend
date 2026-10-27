const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

const tunnelPort = Number(process.env.META_TUNNEL_PORT || 4000);
const upstreamUrl = new URL(
  process.env.META_WEBHOOK_UPSTREAM || 'http://127.0.0.1:3000',
);
const allowedPath = '/webhooks/meta';
const transport = upstreamUrl.protocol === 'https:' ? https : http;

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url || '/', 'http://localhost');

  if (
    requestUrl.pathname !== allowedPath ||
    !['GET', 'POST'].includes(request.method || '')
  ) {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ message: 'Not found' }));
    return;
  }

  const upstreamRequest = transport.request(
    {
      hostname: upstreamUrl.hostname,
      port: upstreamUrl.port,
      method: request.method,
      path: `${allowedPath}${requestUrl.search}`,
      headers: request.headers,
    },
    (upstreamResponse) => {
      response.writeHead(
        upstreamResponse.statusCode || 502,
        upstreamResponse.headers,
      );
      upstreamResponse.pipe(response);
    },
  );

  upstreamRequest.on('error', () => {
    if (!response.headersSent) {
      response.writeHead(502, { 'content-type': 'application/json' });
    }
    response.end(JSON.stringify({ message: 'Webhook upstream unavailable' }));
  });

  request.pipe(upstreamRequest);
});

server.listen(tunnelPort, '127.0.0.1', () => {
  console.log(
    `Meta webhook tunnel proxy listening on http://127.0.0.1:${tunnelPort}${allowedPath}`,
  );
});
