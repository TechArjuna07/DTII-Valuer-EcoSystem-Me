import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { logger } from '../../config/logger.js';

/**
 * Appends annexures (location map, ready-reckoner evidence, market listings …) to a rendered report PDF.
 * PDF annexures are copied page by page; JPEG / PNG images are placed on their own A4 page under a title.
 * Annexures that cannot be read are skipped (and logged) — they never block the report.
 *
 * @param {Buffer} reportPdf
 * @param {{ title: string, mimeType: string, buffer: Buffer }[]} annexures
 * @param {{ headerText?: string }} [opts]  printed top-right on image pages (matches the report header)
 * @returns {Promise<Buffer>}
 */
async function appendAnnexures(reportPdf, annexures, { headerText = '' } = {}) {
  if (!annexures.length) return reportPdf;
  const doc = await PDFDocument.load(reportPdf);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const small = await doc.embedFont(StandardFonts.Helvetica);
  const A4 = [595.28, 841.89];
  const margin = 34;
  for (const a of annexures) {
    try {
      if (a.mimeType === 'application/pdf') {
        const src = await PDFDocument.load(a.buffer, { ignoreEncryption: false });
        const pages = await doc.copyPages(src, src.getPageIndices());
        pages.forEach((p) => doc.addPage(p));
        continue;
      }
      const img = a.mimeType === 'image/png' ? await doc.embedPng(a.buffer) : a.mimeType === 'image/jpeg' ? await doc.embedJpg(a.buffer) : null;
      if (!img) continue;
      const page = doc.addPage(A4);
      if (headerText) page.drawText(headerText, { x: A4[0] - margin - small.widthOfTextAtSize(headerText, 8), y: A4[1] - 22, size: 8, font: small, color: rgb(0.2, 0.2, 0.2) });
      const title = a.title.slice(0, 90);
      page.drawText(title, { x: (A4[0] - font.widthOfTextAtSize(title, 12)) / 2, y: A4[1] - 52, size: 12, font });
      const maxW = A4[0] - margin * 2;
      const maxH = A4[1] - 52 - 20 - margin;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1.5);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, { x: (A4[0] - w) / 2, y: A4[1] - 70 - h, width: w, height: h });
    } catch (e) {
      logger.warn({ err: e.message, annexure: a.title }, 'Annexure skipped');
    }
  }
  return Buffer.from(await doc.save());
}

export { appendAnnexures };
