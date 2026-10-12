/**
 * Official Payment Receipt PDF Generator using PDFKit
 * Smart E-Tender Management System
 * Maharashtra Institute of Technology (MIT), Chhatrapati Sambhajinagar
 */

const PDFDocument = require('pdfkit');

function numberToWords(amount) {
  const words = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'
  ];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const num = Math.floor(amount);
  if (num === 0) return 'Zero';

  function convertBelowThousand(n) {
    if (n === 0) return '';
    if (n < 20) return words[n] + ' ';
    if (n < 100) return tens[Math.floor(n / 10)] + ' ' + (n % 10 !== 0 ? words[n % 10] + ' ' : '');
    return words[Math.floor(n / 100)] + ' Hundred ' + (n % 100 !== 0 ? convertBelowThousand(n % 100) : '');
  }

  let result = '';
  const crore = Math.floor(num / 10000000);
  const lakh = Math.floor((num % 10000000) / 100000);
  const thousand = Math.floor((num % 100000) / 1000);
  const remainder = num % 1000;

  if (crore > 0) result += convertBelowThousand(crore) + 'Crore ';
  if (lakh > 0) result += convertBelowThousand(lakh) + 'Lakh ';
  if (thousand > 0) result += convertBelowThousand(thousand) + 'Thousand ';
  if (remainder > 0) result += convertBelowThousand(remainder);

  return result.trim() + ' Rupees Only';
}

function generatePaymentReceiptPdf(payment, res) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="MIT_Receipt_${payment.receipt_no}.pdf"`
  );
  doc.pipe(res);

  const isTest = payment.payment_mode === 'test';
  const amountRupees = parseFloat(payment.amount_rupees || 0);

  // 1. Institution Header Banner
  doc.rect(0, 0, 595.28, 85).fill('#0a2540');
  doc.fillColor('#ffffff').fontSize(15).font('Helvetica-Bold').text('MAHARASHTRA INSTITUTE OF TECHNOLOGY (MIT)', 40, 20);
  doc.fontSize(10).font('Helvetica').text('CHHATRAPATI SAMBHAJINAGAR, MAHARASHTRA - 431005', 40, 40);
  doc.fontSize(8.5).font('Helvetica-Oblique').fillColor('#93c5fd').text('Central Purchase Committee | Official E-Tender Payment Receipt', 40, 56);

  // 2. Mode Alert Banner
  if (isTest) {
    doc.rect(40, 95, 515, 24).fill('#fef3c7');
    doc.fillColor('#92400e').fontSize(9).font('Helvetica-Bold')
      .text('⚠️ TEST TRANSACTION — NO REAL MONEY TRANSFERRED (DEMO / AUDIT SIMULATION)', 50, 102);
  } else {
    doc.rect(40, 95, 515, 24).fill('#dcfce7');
    doc.fillColor('#166534').fontSize(9).font('Helvetica-Bold')
      .text('✅ VERIFIED INSTITUTIONAL REVENUE TRANSACTION — FUNDS CAPTURED & RECORDED', 50, 102);
  }

  // 3. Receipt Reference & Status
  doc.fillColor('#0f172a').fontSize(14).font('Helvetica-Bold').text('E-PROCUREMENT PAYMENT RECEIPT', 40, 132);
  doc.fontSize(9.5).font('Helvetica').fillColor('#475569')
    .text(`Receipt Reference: ${payment.receipt_no} | Date: ${new Date(payment.paid_at || payment.created_at).toLocaleString('en-IN')}`, 40, 150);

  doc.strokeColor('#cbd5e1').lineWidth(1).moveTo(40, 165).lineTo(555, 165).stroke();

  // 4. Contractor & Tender Details Table
  let currentY = 180;

  doc.rect(40, currentY, 515, 80).fill('#f8fafc');
  doc.strokeColor('#e2e8f0').lineWidth(1).rect(40, currentY, 515, 80).stroke();

  doc.fillColor('#1e293b').fontSize(10).font('Helvetica-Bold').text('CONTRACTOR / VENDOR DETAILS:', 50, currentY + 10);
  doc.fontSize(9).font('Helvetica')
    .text(`Company Name: ${payment.company_name || 'Registered Contractor'}`, 50, currentY + 26)
    .text(`License No: ${payment.license_number || 'N/A'}`, 50, currentY + 40)
    .text(`GSTIN / Tax ID: ${payment.gst_number || 'Registered Vendor'}`, 50, currentY + 54);

  doc.font('Helvetica-Bold').text('TENDER DETAILS:', 310, currentY + 10);
  doc.font('Helvetica')
    .text(`Tender Code: ${payment.tender_code || 'N/A'}`, 310, currentY + 26)
    .text(`Department: ${payment.department || 'Central Purchase'}`, 310, currentY + 40)
    .text(`Title: ${(payment.tender_title || '').substring(0, 32)}...`, 310, currentY + 54);

  // 5. Payment Particulars Box
  currentY = 275;

  doc.rect(40, currentY, 515, 130).fill('#ffffff');
  doc.strokeColor('#cbd5e1').lineWidth(1).rect(40, currentY, 515, 130).stroke();

  doc.rect(40, currentY, 515, 26).fill('#1e3a8a');
  doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold')
    .text('PAYMENT PARTICULARS', 50, currentY + 8)
    .text('AMOUNT (INR)', 450, currentY + 8);

  const paymentTypeName = payment.payment_type === 'TENDER_FEE' 
    ? 'Tender Application & Tender Document Fee' 
    : 'Earnest Money Deposit (EMD)';

  doc.fillColor('#1e293b').fontSize(10).font('Helvetica-Bold').text(paymentTypeName, 50, currentY + 38);
  doc.fontSize(8.5).font('Helvetica').fillColor('#64748b')
    .text(`Obligation fulfilled for participation in MIT Tender ${payment.tender_code}`, 50, currentY + 52);

  doc.fillColor('#0f172a').fontSize(12).font('Helvetica-Bold')
    .text(`₹ ${amountRupees.toLocaleString('en-IN')}`, 440, currentY + 40);

  doc.strokeColor('#e2e8f0').lineWidth(0.8).moveTo(50, currentY + 70).lineTo(545, currentY + 70).stroke();

  doc.fontSize(9).font('Helvetica-Bold').fillColor('#1e293b').text('Amount in Words:', 50, currentY + 80);
  doc.font('Helvetica').fillColor('#334155').text(numberToWords(amountRupees), 145, currentY + 80);

  doc.font('Helvetica-Bold').fillColor('#1e293b').text('Payment Status:', 50, currentY + 100);
  doc.font('Helvetica-Bold').fillColor('#166534').text('PAID / CONFIRMED', 145, currentY + 100);

  doc.font('Helvetica-Bold').fillColor('#1e293b').text('Payment Gateway:', 320, currentY + 100);
  doc.font('Helvetica').fillColor('#334155').text(`Razorpay (${payment.payment_mode.toUpperCase()})`, 425, currentY + 100);

  // 6. Gateway Audit & Verification Box
  currentY = 420;
  doc.rect(40, currentY, 515, 80).fill('#f1f5f9');
  doc.strokeColor('#cbd5e1').lineWidth(1).rect(40, currentY, 515, 80).stroke();

  doc.fillColor('#0f172a').fontSize(9.5).font('Helvetica-Bold').text('CRYPTOGRAPHIC TRANSACTION VERIFICATION:', 50, currentY + 10);
  doc.fontSize(8.5).font('Helvetica').fillColor('#334155')
    .text(`• Provider Order ID: ${payment.provider_order_id || 'N/A'}`, 50, currentY + 26)
    .text(`• Provider Payment ID: ${payment.provider_payment_id || 'N/A'}`, 50, currentY + 40)
    .text(`• Signature Verified: ${payment.signature_verified ? 'Yes (HMAC SHA-256 Server Validated)' : 'Pending'}`, 50, currentY + 54);

  doc.text(`• Paid Timestamp: ${payment.paid_at ? new Date(payment.paid_at).toLocaleString('en-IN') : 'N/A'}`, 310, currentY + 26)
    .text(`• Payment Mode: ${payment.payment_mode.toUpperCase()}`, 310, currentY + 40)
    .text(`• Internal Record ID: #${payment.id}`, 310, currentY + 54);

  // 7. Important Notes & Seal
  currentY = 520;
  doc.fillColor('#475569').fontSize(8.5).font('Helvetica')
    .text('TERMS & CONDITIONS:', 40, currentY);
  doc.fontSize(8).text(
    '1. Tender Application Fees are non-refundable statutory processing charges as per college procurement guidelines.\n' +
    '2. Earnest Money Deposit (EMD) is held as bid security and will be released strictly according to college procurement regulations.\n' +
    '3. This is an electronically generated institutional receipt issued by MIT Smart Tender Management System. No physical signature is required.',
    40, currentY + 14, { lineGap: 3 }
  );

  // 8. Bottom Seal / Watermark
  doc.rect(40, 680, 515, 45).fill('#0a2540');
  doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold')
    .text('MAHARASHTRA INSTITUTE OF TECHNOLOGY | E-PROCUREMENT PORTAL', 50, 692);
  doc.fontSize(7.5).font('Helvetica').fillColor('#94a3b8')
    .text('Beed Bypass Road, Satara Parisar, Chhatrapati Sambhajinagar, Maharashtra - 431005 | https://mit.asia', 50, 706);

  doc.end();
}

module.exports = {
  generatePaymentReceiptPdf,
  numberToWords
};
