// The SMTP transport against a fake server on a loopback port.
//
// The suites use nodemailer's `jsonTransport`, which captures a message and never opens a socket
// — so nothing in CI had ever proved that the client speaks SMTP the way this mailer configures
// it. A major upgrade of nodemailer is exactly when that matters. This is a tiny ESMTP server
// (greeting, EHLO, MAIL, RCPT, DATA, QUIT — no TLS, no AUTH) and one message through it.
import { once } from 'node:events';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createSmtpTransport } from './mailer';

interface Received {
  from: string | null;
  to: string[];
  data: string;
  commands: string[];
}

const fakeSmtp = async (): Promise<{ server: Server; port: number; received: Received }> => {
  const received: Received = { from: null, to: [], data: '', commands: [] };
  const server = createServer((socket: Socket) => {
    let buffer = '';
    let inData = false;
    const reply = (line: string): void => {
      socket.write(`${line}\r\n`);
    };
    reply('220 fake.ecms.local ESMTP');
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        const end = buffer.indexOf('\r\n');
        if (end === -1) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            reply('250 2.0.0 OK: queued as fake-1');
          } else {
            received.data += `${line.startsWith('..') ? line.slice(1) : line}\r\n`;
          }
          continue;
        }
        const verb = line.split(' ')[0]?.toUpperCase() ?? '';
        received.commands.push(verb);
        if (verb === 'EHLO' || verb === 'HELO') {
          socket.write('250-fake.ecms.local\r\n250-8BITMIME\r\n250 SIZE 10485760\r\n');
        } else if (verb === 'MAIL') {
          received.from = /<([^>]*)>/.exec(line)?.[1] ?? line;
          reply('250 2.1.0 OK');
        } else if (verb === 'RCPT') {
          received.to.push(/<([^>]*)>/.exec(line)?.[1] ?? line);
          reply('250 2.1.5 OK');
        } else if (verb === 'DATA') {
          inData = true;
          reply('354 End data with <CR><LF>.<CR><LF>');
        } else if (verb === 'QUIT') {
          reply('221 2.0.0 Bye');
          socket.end();
        } else {
          reply('250 OK');
        }
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, port: (server.address() as AddressInfo).port, received };
};

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((r) => server.close(r))));
});

describe('the SMTP transport', () => {
  it('delivers a multipart message through a plain ESMTP session', async () => {
    const { server, port, received } = await fakeSmtp();
    servers.push(server);
    const transport = createSmtpTransport({
      host: '127.0.0.1',
      port,
      secure: false,
      user: '',
      password: '',
    });
    try {
      const info = (await transport.sendMail({
        from: 'EGYCASH <no-reply@ecms.local>',
        to: 'someone@ecms.local',
        subject: 'رابط إعداد الحساب',
        text: 'النص العادي',
        html: '<p>النص <b>المنسّق</b></p>',
      })) as { accepted: string[]; rejected: string[]; response: string };

      expect(info.accepted).toEqual(['someone@ecms.local']);
      expect(info.rejected).toEqual([]);
      expect(info.response).toMatch(/^250/);
      expect(received.from).toBe('no-reply@ecms.local');
      expect(received.to).toEqual(['someone@ecms.local']);
      // The session went EHLO → MAIL → RCPT → DATA, in that order, and said goodbye.
      expect(received.commands.slice(0, 4)).toEqual(['EHLO', 'MAIL', 'RCPT', 'DATA']);
      // Both bodies travelled, in a multipart/alternative, with the subject encoded for Arabic.
      expect(received.data).toMatch(/Content-Type: multipart\/alternative/);
      expect(received.data).toMatch(/Subject: =\?UTF-8\?/);
      expect(received.data).toMatch(/text\/plain/);
      expect(received.data).toMatch(/text\/html/);
    } finally {
      transport.close();
    }
  });

  it('reports a refused recipient as a failure rather than a silent drop', async () => {
    const { server, port } = await fakeSmtp();
    servers.push(server);
    // A server that refuses every recipient: nodemailer must reject, and the adapter above this
    // turns that into a failed channel with the reason — never an "ok".
    server.removeAllListeners('connection');
    server.on('connection', (socket: Socket) => {
      socket.write('220 refusing ESMTP\r\n');
      socket.on('data', (chunk: Buffer) => {
        const verb = chunk.toString('utf8').split(' ')[0]?.toUpperCase() ?? '';
        if (verb === 'EHLO') socket.write('250 refusing\r\n');
        else if (verb === 'MAIL') socket.write('250 OK\r\n');
        else if (verb === 'RCPT') socket.write('550 5.1.1 no such user\r\n');
        else if (verb === 'QUIT') socket.end('221 Bye\r\n');
        else socket.write('250 OK\r\n');
      });
    });
    const transport = createSmtpTransport({
      host: '127.0.0.1',
      port,
      secure: false,
      user: '',
      password: '',
    });
    try {
      await expect(
        transport.sendMail({
          from: 'a@ecms.local',
          to: 'nobody@ecms.local',
          subject: 'x',
          text: 'x',
        }),
      ).rejects.toThrow(/550|no such user|recipient/i);
    } finally {
      transport.close();
    }
  });
});
