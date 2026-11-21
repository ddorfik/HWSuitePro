/**
 * Kleiner PDF-Generator ohne externe Abhängigkeiten.
 * Reicht für Rechnungen, Angebote, Aufträge und Mahnungen (A4, Helvetica).
 */

const HELVETICA = {
  ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556,
  '8': 556, '9': 556, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556,
  '@': 1015, A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722,
  I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
  k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
  u: 556, v: 500, w: 722, x: 500, y: 500, z: 500, '{': 334, '|': 260, '}': 334, '~': 584,
  ä: 556, ö: 556, ü: 556, Ä: 667, Ö: 778, Ü: 722, ß: 611, '€': 556,
  '–': 556, '—': 1000, '„': 333, '“': 444, '”': 444, '‚': 278, '‘': 278, '’': 278,
  '•': 350, '·': 278, '×': 584, '°': 400,
};

const WINANSI_SPECIAL = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87,
  'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, '‘': 0x91, '’': 0x92,
  '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99, '›': 0x9b,
  'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

function encode(text) {
  let out = '';
  for (const ch of String(text)) {
    let code = ch.codePointAt(0);
    if (code > 255) code = WINANSI_SPECIAL[ch] ?? 63;
    out += String.fromCharCode(code);
  }
  return out.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

const num = (value) => (Math.round(Number(value) * 100) / 100).toString();

function hexToRgb(hex = '#000000') {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  return [
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255,
  ].map((v) => Math.round(v * 1000) / 1000);
}

export function textWidth(text, size = 10, bold = false) {
  let units = 0;
  for (const ch of String(text)) units += HELVETICA[ch] ?? 556;
  const width = (units / 1000) * size;
  return bold ? width * 1.03 : width;
}

/**
 * Liest Breite, Höhe und Farbkanäle aus einem JPEG (SOF-Marker).
 * Wird auch von der Logo-Verwaltung zur Validierung genutzt.
 */
export function jpegInfo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let pos = 2;
  while (pos < buffer.length - 1) {
    if (buffer[pos] !== 0xff) { pos += 1; continue; }
    const marker = buffer[pos + 1];
    pos += 2;
    if (marker === 0xff) { pos -= 1; continue; }
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (pos + 2 > buffer.length) return null;
    const length = buffer.readUInt16BE(pos);
    if (length < 2 || pos + length > buffer.length) return null;
    const isSof = (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      if (pos + 8 > buffer.length) return null;
      const height = buffer.readUInt16BE(pos + 3);
      const width = buffer.readUInt16BE(pos + 5);
      const components = buffer[pos + 7];
      if (!width || !height || ![1, 3, 4].includes(components)) return null;
      return {
        width,
        height,
        components,
        colorSpace: components === 1 ? 'DeviceGray' : components === 3 ? 'DeviceRGB' : 'DeviceCMYK',
        progressive: marker === 0xc2 || marker === 0xc3,
      };
    }
    pos += length;
  }
  return null;
}

// PDF-Name für MIME-Typen: Sonderzeichen als #XX kodieren.
function pdfName(value) {
  return String(value || 'application/octet-stream').replace(/[^A-Za-z0-9._-]/g, (char) =>
    `#${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
}

function pdfDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

const xmpEscape = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function xmpMetadata(doc) {
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xmpEscape(doc.title)}</rdf:li></rdf:Alt></dc:title>
      <dc:creator><rdf:Seq><rdf:li>${xmpEscape(doc.author)}</rdf:li></rdf:Seq></dc:creator>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <xmp:CreatorTool>HandwerkPro</xmp:CreatorTool>
      <xmp:CreateDate>${new Date().toISOString()}</xmp:CreateDate>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

export class PDF {
  constructor({ width = 595.28, height = 841.89, title = 'Dokument', author = '' } = {}) {
    this.width = width;
    this.height = height;
    this.title = title;
    this.author = author;
    this.pages = [];
    this.current = null;
    this.attachments = [];
    this.images = [];
    this.addPage();
  }

  /** Bettet eine Datei (z. B. ZUGFeRD-XML) in das PDF ein. */
  attach({ name, mime = 'application/octet-stream', data, description = '' }) {
    this.attachments.push({ name, mime, data, description });
    return this;
  }

  addPage() {
    this.current = [];
    this.pages.push(this.current);
    return this;
  }

  _op(op) {
    this.current.push(op);
    return this;
  }

  color(hex, stroke = false) {
    const [r, g, b] = hexToRgb(hex);
    this._op(`${r} ${g} ${b} ${stroke ? 'RG' : 'rg'}`);
    return this;
  }

  text(text, x, top, { size = 10, bold = false, color = '#111827', align = 'left', width = 0 } = {}) {
    if (text == null || text === '') return this;
    const font = bold ? '/F2' : '/F1';
    let drawX = x;
    if (align === 'right') drawX = x - textWidth(text, size, bold);
    if (align === 'center') drawX = x - textWidth(text, size, bold) / 2;
    const y = this.height - top;
    this.color(color)
      ._op(`BT ${font} ${num(size)} Tf 1 0 0 1 ${num(drawX)} ${num(y)} Tm (${encode(text)}) Tj ET`);
    return this;
  }

  textRight(text, rightX, top, opts = {}) {
    return this.text(text, rightX, top, { ...opts, align: 'right' });
  }

  textCenter(text, centerX, top, opts = {}) {
    return this.text(text, centerX, top, { ...opts, align: 'center' });
  }

  line(x1, top1, x2, top2, { color = '#d1d5db', width = 0.6 } = {}) {
    const y1 = this.height - top1;
    const y2 = this.height - top2;
    this.color(color, true)
      ._op(`${num(width)} w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`);
    return this;
  }

  rect(x, top, w, h, { fill = null, stroke = null, lineWidth = 0.6 } = {}) {
    const y = this.height - top - h;
    if (fill) {
      this.color(fill)._op(`${num(x)} ${num(y)} ${num(w)} ${num(h)} re f`);
    }
    if (stroke) {
      this.color(stroke, true)._op(`${num(x)} ${num(y)} ${num(w)} ${num(h)} re S ${num(lineWidth)} w`);
    }
    return this;
  }

  /**
   * Zeichnet ein JPEG in einen Rahmen und behält das Seitenverhältnis bei.
   * Gibt die tatsächlich gezeichnete Größe zurück oder null bei ungültigen Daten.
   */
  image(buffer, x, top, { maxWidth = 100, maxHeight = 100, align = 'left', valign = 'top' } = {}) {
    const info = jpegInfo(buffer);
    if (!info) return null;
    const scale = Math.min(maxWidth / info.width, maxHeight / info.height);
    const width = info.width * scale;
    const height = info.height * scale;
    const drawX = align === 'center' ? x + (maxWidth - width) / 2
      : align === 'right' ? x + maxWidth - width : x;
    const boxTop = this.height - top;
    const drawY = valign === 'middle' ? boxTop - (maxHeight + height) / 2
      : valign === 'bottom' ? boxTop - maxHeight
        : boxTop - height;
    const name = `/Im${this.images.length + 1}`;
    this.images.push({ name, buffer, info });
    this._op(`q ${num(width)} 0 0 ${num(height)} ${num(drawX)} ${num(drawY)} cm ${name} Do Q`);
    return { width, height };
  }

  wrap(text, maxWidth, size = 10, bold = false) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = '';
    for (const word of words) {
      const attempt = line ? `${line} ${word}` : word;
      if (textWidth(attempt, size, bold) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = attempt;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  paragraph(text, x, top, maxWidth, { size = 10, bold = false, color = '#111827', lineHeight = 14 } = {}) {
    let y = top;
    const blocks = String(text).split('\n');
    for (const block of blocks) {
      if (block.trim() === '') {
        y += lineHeight;
        continue;
      }
      const lines = this.wrap(block, maxWidth, size, bold);
      lines.forEach((line) => {
        this.text(line, x, y, { size, bold, color });
        y += lineHeight;
      });
    }
    return y;
  }

  build() {
    const objects = [];
    const addObject = (content) => {
      objects.push(content);
      return objects.length;
    };

    const catalogId = addObject(null); // 1
    const pagesId = addObject(null); // 2
    const fontRegular = addObject(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
    ); // 3
    const fontBold = addObject(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
    ); // 4

    const imageIds = this.images.map((image) => {
      const stream = image.buffer.toString('latin1');
      const decode = image.info.components === 4 ? ' /Decode [1 0 1 0 1 0 1 0]' : '';
      return addObject(
        `<< /Type /XObject /Subtype /Image /Width ${image.info.width} /Height ${image.info.height} ` +
        `/ColorSpace /${image.info.colorSpace} /BitsPerComponent 8 /Filter /DCTDecode${decode} ` +
        `/Length ${image.buffer.length} >>\nstream\n${stream}\nendstream`
      );
    });
    const xobjects = imageIds.length
      ? ` /XObject << ${this.images.map((image, index) => `${image.name} ${imageIds[index]} 0 R`).join(' ')} >>`
      : '';

    const pageIds = [];
    for (const ops of this.pages) {
      const stream = ops.join('\n');
      const contentId = addObject(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
      const pageId = addObject(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(this.width)} ${num(this.height)}] ` +
        `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >>${xobjects} >> /Contents ${contentId} 0 R >>`
      );
      pageIds.push(pageId);
    }

    // Eingebettete Dateien (ZUGFeRD) und XMP-Metadaten.
    const filespecIds = [];
    for (const attachment of this.attachments) {
      const bytes = Buffer.isBuffer(attachment.data)
        ? attachment.data
        : Buffer.from(String(attachment.data ?? ''), 'utf8');
      const stream = bytes.toString('latin1');
      const embeddedId = addObject(
        `<< /Type /EmbeddedFile /Subtype /${pdfName(attachment.mime)} /Length ${bytes.length} ` +
        `/Params << /Size ${bytes.length} /ModDate (D:${pdfDate()}) >> >>\nstream\n${stream}\nendstream`
      );
      filespecIds.push(addObject(
        `<< /Type /Filespec /F (${encode(attachment.name)}) /UF (${encode(attachment.name)}) ` +
        `/Desc (${encode(attachment.description || attachment.name)}) /EF << /F ${embeddedId} 0 R >> >>`
      ));
    }

    let namesId = null;
    if (filespecIds.length) {
      namesId = addObject(
        `<< /EmbeddedFiles << /Names [${this.attachments
          .map((attachment, index) => `(${encode(attachment.name)}) ${filespecIds[index]} 0 R`)
          .join(' ')}] >> >>`
      );
    }

    let metadataId = null;
    if (this.attachments.length) {
      metadataId = addObject(
        `<< /Type /Metadata /Subtype /XML /Length ${Buffer.byteLength(xmpMetadata(this), 'utf8')} >>\n` +
        `stream\n${xmpMetadata(this)}\nendstream`
      );
    }

    objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R` +
      `${namesId ? ` /Names ${namesId} 0 R /AF [${filespecIds.map((id) => `${id} 0 R`).join(' ')}]` : ''}` +
      `${metadataId ? ` /Metadata ${metadataId} 0 R` : ''} >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

    let pdf = `${this.attachments.length ? '%PDF-1.7' : '%PDF-1.4'}\n%\xE2\xE3\xCF\xD3\n`;
    const offsets = [0];
    objects.forEach((body, index) => {
      offsets.push(Buffer.byteLength(pdf, 'latin1'));
      pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });

    const xrefOffset = Buffer.byteLength(pdf, 'latin1');
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= objects.length; i += 1) {
      pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info << /Title (${encode(this.title)}) /Author (${encode(this.author)}) /Producer (HandwerkPro) >> >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

    return Buffer.from(pdf, 'latin1');
  }
}

export const euro = (value) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(value) || 0);

export const deDate = (iso) => {
  if (!iso) return '–';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
};

export const deNumber = (value, digits = 2) =>
  new Intl.NumberFormat('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(value) || 0);
