import http from 'node:http';
import type { AddressInfo } from 'node:net';
import iconv from 'iconv-lite';
import { buildResponseEnvelope, extractRequest } from '../src/index.js';

export interface FakeRequest {
  url: string;
  headers: http.IncomingHttpHeaders;
  requestXml: string;
}
export type FakeHandler = (req: FakeRequest) => { status?: number; body: string } | Promise<{ status?: number; body: string }>;

/** Servidor SOAP que imita al RNDC: decodifica ISO-8859-1, entrega el Request y responde con el XML interno indicado. */
export async function startFakeRndc(handler: FakeHandler) {
  const received: FakeRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      const envelope = iconv.decode(Buffer.concat(chunks), 'iso-8859-1');
      const fake: FakeRequest = { url: req.url ?? '', headers: req.headers, requestXml: extractRequest(envelope) };
      received.push(fake);
      const out = await handler(fake);
      res.writeHead(out.status ?? 200, { 'Content-Type': 'text/xml; charset=ISO-8859-1' });
      res.end(iconv.encode(out.status && out.status >= 500 ? out.body : buildResponseEnvelope(out.body), 'iso-8859-1'));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    received,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
