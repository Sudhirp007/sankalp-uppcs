import http from "node:http";

const LISTEN_PORT = Number(process.env.LAN_PORT || 8080);
const TARGET_HOST = "127.0.0.1";
const TARGET_PORT = Number(process.env.WRANGLER_PORT || 8787);

const server = http.createServer((clientReq, clientRes) => {
  const proxyReq = http.request(
    {
      hostname: TARGET_HOST,
      port: TARGET_PORT,
      path: clientReq.url,
      method: clientReq.method,
      headers: {
        ...clientReq.headers,
        host: `${TARGET_HOST}:${TARGET_PORT}`,
      },
    },
    (proxyRes) => {
      clientRes.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(clientRes, { end: true });
    }
  );

  proxyReq.on("error", (err) => {
    clientRes.writeHead(502, { "Content-Type": "application/json" });
    clientRes.end(JSON.stringify({ error: "Upstream Wrangler Worker unavailable", detail: err.message }));
  });

  clientReq.pipe(proxyReq, { end: true });
});

server.listen(LISTEN_PORT, "0.0.0.0", () => {
  console.log(
    `[Sankalp Mobile Wi-Fi Bridge] Listening on http://0.0.0.0:${LISTEN_PORT} -> http://${TARGET_HOST}:${TARGET_PORT}`
  );
});
