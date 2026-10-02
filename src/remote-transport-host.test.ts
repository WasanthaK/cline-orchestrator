import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { RemoteSessionGateway } from "./remote-session-gateway.js";
import {
  createLoopbackRemoteTransportServer,
  listenLoopbackRemoteTransport,
  type RemoteTransportReadService,
} from "./remote-transport.js";

async function close(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function requestWithHost(port: number, hostHeader: string): Promise<{
  statusCode: number;
  body: { code?: string };
}> {
  return await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: "/remote/v1/read/visualization",
      method: "POST",
      headers: {
        host: hostHeader,
        authorization: "Bearer rct_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ",
        "content-type": "application/json",
        "x-orchestrator-request-id": "88888888-8888-4888-8888-888888888881",
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve({
          statusCode: res.statusCode ?? 0,
          body: raw ? JSON.parse(raw) as { code?: string } : {},
        });
      });
    });
    req.once("error", reject);
    req.end("{}");
  });
}

test("loopback remote transport rejects non-loopback Host before session or read handling", async () => {
  const sessions = new Proxy({} as RemoteSessionGateway, {
    get() {
      throw new Error("session gateway must not be reached for rejected Host");
    },
  });
  const reads = new Proxy({} as RemoteTransportReadService, {
    get() {
      throw new Error("read service must not be reached for rejected Host");
    },
  });
  const server = createLoopbackRemoteTransportServer(sessions, reads, {
    host: "127.0.0.1",
    port: 0,
  });
  try {
    const address = await listenLoopbackRemoteTransport(server, {
      host: "127.0.0.1",
      port: 0,
    });
    const response = await requestWithHost(address.port, "evil.example:4320");
    assert.equal(response.statusCode, 403);
    assert.equal(response.body.code, "host_not_allowed");
  } finally {
    await close(server);
  }
});
