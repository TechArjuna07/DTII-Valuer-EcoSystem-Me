import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

/**
 * Appends an "Electronic signature record" page to a PDF (or creates a stand-alone record if the source cannot be
 * parsed). The page documents who signed what (document SHA-256), when, from where, how, and the legal status.
 * Text is restricted to WinAnsi-safe characters for the standard PDF fonts.
 */
const ascii = (s) => String(s ?? '').replace(/[^\x20-\x7e]/g, '?');

async function appendSignaturePage(sourcePdf, r) {
  let doc;
  try {
    doc = await PDFDocument.load(sourcePdf, { ignoreEncryption: false, updateMetadata: false });
  } catch {
    doc = await PDFDocument.create();
  }
  const page = doc.addPage([595.28, 841.89]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let y = 790;
  const line = (label, value, opts = {}) => {
    page.drawText(ascii(label), { x: 48, y, size: 9, font: bold, color: rgb(0.36, 0.4, 0.48) });
    const text = ascii(value);
    for (let i = 0; i < text.length; i += 80) {
      page.drawText(text.slice(i, i + 80), { x: 190, y, size: opts.mono ? 8 : 10, font, color: rgb(0.04, 0.07, 0.14) });
      y -= 14;
    }
    y -= 4;
  };
  page.drawRectangle({ x: 0, y: 811, width: 595.28, height: 31, color: rgb(0.04, 0.09, 0.2) });
  page.drawText('ELECTRONIC SIGNATURE RECORD', { x: 48, y: 822, size: 12, font: bold, color: rgb(1, 1, 1) });
  line('Case ID', r.caseNumber);
  line('Document', r.documentTitle);
  line('Signer', `${r.signerName} <${r.signerEmail}>`);
  line('Role', r.signerRole === 'VALUER' ? 'Valuer (report issuer)' : 'Client (acknowledgement of report)');
  line('Signed at (UTC)', r.signedAt);
  line('IP address', r.ip ?? '-');
  line('Provider', r.provider);
  line('Algorithm', r.signatureAlgorithm);
  line('Certificate subject', r.certSubject ?? '-');
  line('Certificate issuer', r.certIssuer ?? '-');
  line('Document SHA-256', r.documentSha256, { mono: true });
  line('Signature value', r.signatureValue ?? '-', { mono: true });
  line('Consent', r.consentText);
  y -= 10;
  page.drawText(ascii(r.legallyValid ? 'Signed through a certificate-based signature provider.' : 'SANDBOX SIGNATURE - for testing only. Not a legally valid digital signature under the IT Act, 2000.'), {
    x: 48,
    y,
    size: 10,
    font: bold,
    color: r.legallyValid ? rgb(0.07, 0.54, 0.32) : rgb(0.71, 0.28, 0.03),
  });
  return Buffer.from(await doc.save());
}

export { appendSignaturePage };
