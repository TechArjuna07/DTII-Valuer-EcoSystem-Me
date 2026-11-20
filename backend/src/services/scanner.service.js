import net from 'node:net';
import { env } from '../config/env.js';

/**
 * Malware scanning. SCANNER=none (development) marks files SKIPPED; SCANNER=clamav streams the bytes to clamd
 * with the INSTREAM protocol. Any other scanner can be plugged in behind scanBuffer().
 * @returns {Promise<'CLEAN'|'INFECTED'|'SKIPPED'|'ERROR'>}
 */
async function scanBuffer(buffer) {
  if (env.SCANNER === 'none') return 'SKIPPED';
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: env.CLAMAV_HOST, port: env.CLAMAV_PORT });
    let reply = '';
    const done = (status) => {
      socket.destroy();
      resolve(status);
    };
    socket.setTimeout(60_000, () => done('ERROR'));
    socket.on('error', () => done('ERROR'));
    socket.on('data', (d) => (reply += d.toString()));
    socket.on('end', () => done(/OK\0?$/.test(reply.trim()) ? 'CLEAN' : /FOUND/.test(reply) ? 'INFECTED' : 'ERROR'));
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      for (let i = 0; i < buffer.length; i += 64 * 1024) {
        const chunk = buffer.subarray(i, i + 64 * 1024);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(chunk.length);
        socket.write(len);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4)); // zero-length chunk terminates the stream
    });
  });
}

/** Only these statuses may be downloaded. */
const DOWNLOADABLE = ['CLEAN', 'SKIPPED'];

export { scanBuffer, DOWNLOADABLE };
