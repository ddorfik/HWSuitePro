/**
 * Minimaler SMTP-Client ohne Abhängigkeiten.
 * Unterstützt implizites TLS (Port 465), STARTTLS, AUTH PLAIN/LOGIN und
 * UTF-8-Nachrichten mit Text- und HTML-Teil.
 */
import net from 'node:net';
import tls from 'node:tls';
import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { getSettings } from './db.js';

const TIMEOUT = 15000;

export function mailSettings() {
  const settings = getSettings();
  return {
    host: String(settings.smtp_host || '').trim(),
    port: Number(settings.smtp_port) || 587,
    secure: String(settings.smtp_secure) === '1',
    user: String(settings.smtp_user || '').trim(),
    password: String(settings.smtp_password || ''),
    from: String(settings.smtp_from || settings.company_email || '').trim(),
    fromName: String(settings.smtp_from_name || settings.company_name || '').trim(),
  };
}

export function mailConfigured() {
  const config = mailSettings();
  return Boolean(config.host && config.from);
}

function attachReader(socket) {
  let buffer = '';
  const waiting = [];

  const pump = () => {
    while (waiting.length) {
      const match = buffer.match(/^(\d{3}) [^\r\n]*\r\n/m);
      if (!match) return;
      const end = match.index + match[0].length;
      const text = buffer.slice(0, end);
      buffer = buffer.slice(end);
      const waiter = waiting.shift();
      clearTimeout(waiter.timer);
      waiter.resolve({ code: Number(match[1]), text });
    }
  };

  const fail = (error) => {
    while (waiting.length) {
      const waiter = waiting.shift();
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  };

  const onData = (chunk) => {
    buffer += chunk.toString('utf8');
    pump();
  };
  const onError = (error) => fail(error);
  const onClose = () => fail(new Error('Mailserver hat die Verbindung geschlossen'));

  socket.on('data', onData);
  socket.on('error', onError);
  socket.on('close', onClose);

  return {
    read() {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Zeitüberschreitung beim Mailserver')), TIMEOUT);
        waiting.push({ resolve, reject, timer });
        pump();
      });
    },
    detach() {
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
      fail(new Error('Verbindung beendet'));
    },
  };
}

function connect(config) {
  return new Promise((resolve, reject) => {
    const socket = config.secure
      ? tls.connect({ host: config.host, port: config.port, servername: config.host })
      : net.connect({ host: config.host, port: config.port });
    socket.setTimeout(TIMEOUT, () => {
      socket.destroy();
      reject(new Error(`Keine Verbindung zu ${config.host}:${config.port}`));
    });
    socket.once('error', reject);
    socket.once(config.secure ? 'secureConnect' : 'connect', () => {
      socket.removeListener('error', reject);
      socket.setTimeout(0);
      resolve(socket);
    });
  });
}

function startTls(socket, config) {
  return new Promise((resolve, reject) => {
    const secure = tls.connect({ socket, servername: config.host });
    secure.setTimeout(TIMEOUT, () => {
      secure.destroy();
      reject(new Error('Zeitüberschreitung bei STARTTLS'));
    });
    secure.once('secureConnect', () => {
      secure.setTimeout(0);
      resolve(secure);
    });
    secure.once('error', reject);
  });
}

const writeLine = (socket, line) => new Promise((resolve, reject) => {
  socket.write(`${line}\r\n`, (error) => (error ? reject(error) : resolve()));
});

async function expectCode(reader, codes, step) {
  const response = await reader.read();
  if (!codes.includes(response.code)) {
    const detail = response.text.trim().replace(/\s+/g, ' ');
    throw new Error(`Mailserver hat ${step} abgelehnt (${detail})`);
  }
  return response;
}

const encodeHeader = (value) => (/^[\x20-\x7E]*$/.test(value)
  ? value
  : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`);

const wrap76 = (value) => value.replace(/(.{76})/g, '$1\r\n');

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

function buildMessage({ from, fromName, to, subject, text, html }) {
  const boundary = `handwerkpro-${randomBytes(8).toString('hex')}`;
  const domain = from.split('@')[1] || 'handwerkpro.local';
  const lines = [
    `From: ${fromName ? `${encodeHeader(fromName)} ` : ''}<${from}>`,
    `To: <${to}>`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomBytes(10).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(text, 'utf8').toString('base64')),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(html, 'utf8').toString('base64')),
    `--${boundary}--`,
    '',
  ];
  return lines.join('\r\n');
}

/**
 * Verschickt eine E-Mail. Wirft bei Fehlern eine Error mit lesbarer Meldung.
 */
export async function sendMail({ to, subject, text, html = '' }) {
  const config = mailSettings();
  if (!config.host) throw new Error('E-Mail-Versand ist nicht eingerichtet (SMTP-Server fehlt)');
  if (!config.from) throw new Error('E-Mail-Versand ist nicht eingerichtet (Absenderadresse fehlt)');
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error('Keine gültige Empfängeradresse');

  let socket = await connect(config);
  let reader = attachReader(socket);
  try {
    await expectCode(reader, [220], 'die Begrüßung');

    const ehlo = async () => {
      await writeLine(socket, `EHLO ${hostname() || 'localhost'}`);
      return (await expectCode(reader, [250], 'EHLO')).text;
    };

    let capabilities = await ehlo();
    if (!config.secure && /^250[ -]STARTTLS/im.test(capabilities)) {
      await writeLine(socket, 'STARTTLS');
      await expectCode(reader, [220], 'STARTTLS');
      reader.detach();
      socket = await startTls(socket, config);
      reader = attachReader(socket);
      capabilities = await ehlo();
    }

    if (config.user) {
      if (/^250[ -]AUTH[^\r\n]*\bPLAIN\b/im.test(capabilities)) {
        const credentials = Buffer.from(`\0${config.user}\0${config.password}`, 'utf8').toString('base64');
        await writeLine(socket, `AUTH PLAIN ${credentials}`);
        await expectCode(reader, [235], 'die Anmeldung');
      } else {
        await writeLine(socket, 'AUTH LOGIN');
        await expectCode(reader, [334], 'die Anmeldung');
        await writeLine(socket, Buffer.from(config.user, 'utf8').toString('base64'));
        await expectCode(reader, [334], 'die Anmeldung');
        await writeLine(socket, Buffer.from(config.password, 'utf8').toString('base64'));
        await expectCode(reader, [235], 'die Anmeldung');
      }
    }

    await writeLine(socket, `MAIL FROM:<${config.from}>`);
    await expectCode(reader, [250], 'den Absender');
    await writeLine(socket, `RCPT TO:<${to}>`);
    await expectCode(reader, [250, 251], 'den Empfänger');
    await writeLine(socket, 'DATA');
    await expectCode(reader, [354], 'DATA');

    const message = buildMessage({
      from: config.from,
      fromName: config.fromName,
      to,
      subject,
      text,
      html: html || `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(text)}</pre>`,
    });
    await writeLine(socket, `${message.replace(/^\./gm, '..')}\r\n.`);
    await expectCode(reader, [250], 'die Nachricht');

    await writeLine(socket, 'QUIT');
    await reader.read().catch(() => null);
    return { to };
  } finally {
    reader.detach();
    socket.destroy();
  }
}
