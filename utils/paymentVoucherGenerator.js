/**
 * Payment Disbursement Voucher & EMD Refund Advice PDF Generator
 * Smart E-Tender Management System
 * Maharashtra Institute of Technology (MIT), Chhatrapati Sambhajinagar
 */

const PDFDocument = require('pdfkit');
const { numberToWords } = require('./receiptGenerator');

/**
 * Generates official MIT Payment Disbursement Voucher
 */
function generateContractorPaymentVoucherPdf(paymentRecord, transaction, res) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });

  const filename = `MIT_Disbursement_Voucher_${paymentRecord.work_order_ref || paymentRecord.id}.pdf`;
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  }
  doc.pipe(res);

  const amount = parseFloat(transaction ? transaction.amount : paymentRecord.total_paid_amount || 0);

  // 1. Institution Header Banner
  doc.rect(0, 0, 595.28, 85).fill('#0a2540');
  doc.fillColor('#ffffff').fontSize(15).font('Helvetica-Bold').text('MAHARASHTRA INSTITUTE OF TECHNOLOGY (MIT)', 40, 20);
  doc.fontSize(10).font('Helvetica').text('CHHATRAPATI SAMBHAJINAGAR, MAHARASHTRA - 431005', 40, 40);
  doc.fontSize(8.5).font('Helvetica-Oblique').fillColor('#93c5fd').text('Central Finance & Accounts Department | Contractor Payment Disbursement Voucher', 40, 56);

  // 2. Voucher Sub-header
  doc.rect(40, 95, 515, 24).fill('#e0f2fe');
  doc.fillColor('#0369a1').fontSize(9).font('Helvetica-Bold')
    .text('OFFICIAL CONTRACTOR PAYMENT DISBURSEMENT VOUCHER (INSTITUTION -> CONTRACTOR)', 50, 102);

  // 3. Voucher Reference & Date
  doc.fillColor('#0f172a').fontSize(14).font('Helvetica-Bold').text('PAYMENT DISBURSEMENT VOUCHER', 40, 130);
  doc.fontSize(9.5).font('Helvetica').fillColor('#475569')
    .text(`Voucher Ref: MIT-PV-${paymentRecord.id}-${new Date().getFullYear()} | Work Order: ${paymentRecord.work_order_ref} | Date: ${new Date().toLocaleDateString('en-IN')}`, 40, 148);

  doc.strokeColor('#cbd5e1').lineWidth(1).moveTo(40, 163).lineTo(555, 163).stroke();

  // 4. Contractor & Tender Particulars
  let currentY = 175;
  doc.rect(40, currentY, 515, 80).fill('#f8fafc');
  doc.strokeColor('#e2e8f0').lineWidth(1).rect(40, currentY, 515, 80).stroke();

  doc.fillColor('#1e293b').fontSize(10).font('Helvetica-Bold').text('PAYEE / CONTRACTOR PARTICULARS:', 50, currentY + 10);
  doc.fontSize(9).font('Helvetica')
    .text(`Company: ${paymentRecord.company_name || 'Selected Contractor'}`, 50, currentY + 26)
    .text(`License No: ${paymentRecord.license_number || 'N/A'}`, 50, currentY + 40)
    .text(`GSTIN: ${paymentRecord.gst_number || 'Registered Vendor'}`, 50, currentY + 54);

  doc.font('Helvetica-Bold').text('TENDER & CONTRACT DETAILS:', 310, currentY + 10);
  doc.font('Helvetica')
    .text(`Tender Code: ${paymentRecord.tender_code || 'N/A'}`, 310, currentY + 26)
    .text(`Department: ${paymentRecord.department || 'Central Purchase'}`, 310, currentY + 40)
    .text(`Invoice / Bill Ref: ${paymentRecord.invoice_ref || 'N/A'}`, 310, currentY + 54);

  // 5. Financial Breakdown Box
  currentY = 268;
  doc.rect(40, currentY, 515, 135).fill('#ffffff');
  doc.strokeColor('#cbd5e1').lineWidth(1).rect(40, currentY, 515, 135).stroke();

  doc.rect(40, currentY, 515, 24).fill('#1e3a8a');
  doc.fillColor('#ffffff').fontSize(9.5).font('Helvetica-Bold')
    .text('FINANCIAL ASSESSMENT & SETTLEMENT BREAKDOWN', 50, currentY + 7);

  const contractAmt = parseFloat(paymentRecord.contract_amount || 0);
  const deductionsAmt = parseFloat(paymentRecord.deductions_amount || 0);
  const taxAmt = parseFloat(paymentRecord.tax_amount || 0);
  const retentionAmt = parseFloat(paymentRecord.retention_amount || 0);
  const approvedAmt = parseFloat(paymentRecord.approved_payable_amount || 0);
  const totalPaid = parseFloat(paymentRecord.total_paid_amount || 0);
  const remaining = parseFloat(paymentRecord.remaining_payable_amount || 0);

  doc.fillColor('#334155').fontSize(9).font('Helvetica')
    .text('1. Total Agreed Contract Value:', 50, currentY + 34)
    .text(`₹ ${contractAmt.toLocaleString('en-IN')}`, 440, currentY + 34, { align: 'right' });

  doc.text('2. Approved Deductions / Penalties:', 50, currentY + 49)
    .text(`- ₹ ${deductionsAmt.toLocaleString('en-IN')}`, 440, currentY + 49, { align: 'right' });

  doc.text('3. Statutory Taxes (TDS / GST-TDS):', 50, currentY + 64)
    .text(`- ₹ ${taxAmt.toLocaleString('en-IN')}`, 440, currentY + 64, { align: 'right' });

  doc.text('4. Security Deposit Retention (PBG/Retention):', 50, currentY + 79)
    .text(`- ₹ ${retentionAmt.toLocaleString('en-IN')}`, 440, currentY + 79, { align: 'right' });

  doc.strokeColor('#e2e8f0').lineWidth(0.8).moveTo(50, currentY + 95).lineTo(545, currentY + 95).stroke();

  doc.font('Helvetica-Bold').fillColor('#0f172a')
    .text('5. Net Approved Payable Amount:', 50, currentY + 102)
    .text(`₹ ${approvedAmt.toLocaleString('en-IN')}`, 440, currentY + 102, { align: 'right' });

  doc.font('Helvetica-Bold').fillColor('#166534')
    .text('6. Total Disbursed / Paid to Date:', 50, currentY + 117)
    .text(`₹ ${totalPaid.toLocaleString('en-IN')}`, 440, currentY + 117, { align: 'right' });

  // 6. Transaction Details Box
  currentY = 415;
  doc.rect(40, currentY, 515, 110).fill('#f1f5f9');
  doc.strokeColor('#cbd5e1').lineWidth(1).rect(40, currentY, 515, 110).stroke();

  doc.fillColor('#0f172a').fontSize(9.5).font('Helvetica-Bold').text('TRANSACTION EXECUTION DETAILS:', 50, currentY + 10);
  doc.fontSize(9).font('Helvetica').fillColor('#334155');

  if (transaction) {
    doc.text(`• Disbursed Amount: ₹ ${parseFloat(transaction.amount).toLocaleString('en-IN')}`, 50, currentY + 28)
      .text(`• Payment Method: ${(transaction.payment_method || '').toUpperCase()}`, 50, currentY + 44)
      .text(`• Bank UTR / Cheque Ref: ${transaction.transaction_ref}`, 50, currentY + 60)
      .text(`• Bank Name: ${transaction.bank_name || 'Institutional Current Account'}`, 50, currentY + 76)
      .text(`• Destination A/C Last 4: ${transaction.bank_account_last4 ? '****' + transaction.bank_account_last4 : 'Recorded Vendor A/C'}`, 50, currentY + 92);

    doc.text(`• Payment Date: ${new Date(transaction.payment_date).toLocaleDateString('en-IN')}`, 310, currentY + 28)
      .text(`• Execution Type: ${transaction.execution_type === 'MANUAL_RECORD' ? 'Externally Processed Bank Transfer' : 'Automated Payout'}`, 310, currentY + 44)
      .text(`• Transaction Status: ${transaction.payment_status}`, 310, currentY + 60)
      .text(`• Remaining Liability: ₹ ${remaining.toLocaleString('en-IN')}`, 310, currentY + 76);
  } else {
    doc.text(`• Current Claim Status: ${(paymentRecord.claim_status || '').toUpperCase()}`, 50, currentY + 28)
      .text(`• Total Paid: ₹ ${totalPaid.toLocaleString('en-IN')}`, 50, currentY + 44)
      .text(`• Remaining Payable Liability: ₹ ${remaining.toLocaleString('en-IN')}`, 50, currentY + 60)
      .text(`• Work Status: ${(paymentRecord.work_status || '').toUpperCase()}`, 310, currentY + 28);
  }

  // 7. Amount in words
  currentY = 535;
  doc.fillColor('#1e293b').fontSize(9).font('Helvetica-Bold').text('Disbursed Amount in Words:', 40, currentY);
  doc.font('Helvetica').fillColor('#334155').text(numberToWords(amount), 180, currentY);

  // 8. Signatures & Verification
  currentY = 580;
  doc.strokeColor('#cbd5e1').lineWidth(0.8).moveTo(40, currentY).lineTo(555, currentY).stroke();

  doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#334155')
    .text('Prepared By:', 50, currentY + 20)
    .text('Inspected & Verified By:', 210, currentY + 20)
    .text('Authorized Finance Officer / Principal:', 380, currentY + 20);

  doc.font('Helvetica').fontSize(8).fillColor('#64748b')
    .text('Procurement Cell Staff', 50, currentY + 48)
    .text(paymentRecord.inspected_by_name || 'Site Engineer / Authority', 210, currentY + 48)
    .text(paymentRecord.approved_by_name || 'Central Administration, MIT', 380, currentY + 48);

  // 9. Footnote
  doc.rect(40, 680, 515, 45).fill('#0a2540');
  doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold')
    .text('MAHARASHTRA INSTITUTE OF TECHNOLOGY | E-PROCUREMENT PORTAL', 50, 692);
  doc.fontSize(7.5).font('Helvetica').fillColor('#94a3b8')
    .text('Beed Bypass Road, Satara Parisar, Chhatrapati Sambhajinagar, Maharashtra - 431005 | Official Financial Voucher', 50, 706);

  doc.end();
}

/**
 * Generates official MIT EMD Refund Advice Slip
 */
function generateEmdRefundAdvicePdf(refundRecord, res) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });

  const filename = `MIT_EMD_Refund_Advice_${refundRecord.id}.pdf`;
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  }
  doc.pipe(res);

  const refundAmt = parseFloat(refundRecord.refund_amount || refundRecord.refund_eligible_amount || 0);
  const isForfeited = refundRecord.refund_status === 'FORFEITED';

  // 1. Institution Header Banner
  doc.rect(0, 0, 595.28, 85).fill('#0a2540');
  doc.fillColor('#ffffff').fontSize(15).font('Helvetica-Bold').text('MAHARASHTRA INSTITUTE OF TECHNOLOGY (MIT)', 40, 20);
  doc.fontSize(10).font('Helvetica').text('CHHATRAPATI SAMBHAJINAGAR, MAHARASHTRA - 431005', 40, 40);
  doc.fontSize(8.5).font('Helvetica-Oblique').fillColor('#93c5fd').text('Central Purchase Committee | Official EMD Refund & Settlement Advice', 40, 56);

  // 2. Status Banner
  if (isForfeited) {
    doc.rect(40, 95, 515, 24).fill('#fee2e2');
    doc.fillColor('#991b1b').fontSize(9).font('Helvetica-Bold')
      .text('⚠️ NOTICE OF EARNEST MONEY DEPOSIT (EMD) FORFEITURE — DEPOSIT FORFEITED AS PER RULES', 50, 102);
  } else {
    doc.rect(40, 95, 515, 24).fill('#dcfce7');
    doc.fillColor('#166534').fontSize(9).font('Helvetica-Bold')
      .text('✅ OFFICIAL EARNEST MONEY DEPOSIT (EMD) REFUND ADVICE SLIP', 50, 102);
  }

  // 3. Document Title
  doc.fillColor('#0f172a').fontSize(14).font('Helvetica-Bold')
    .text(isForfeited ? 'EMD FORFEITURE ORDER & ADVICE' : 'EMD REFUND SETTLEMENT ADVICE', 40, 130);
  doc.fontSize(9.5).font('Helvetica').fillColor('#475569')
    .text(`Advice Ref: MIT/EMD-REF/${refundRecord.id}/${new Date().getFullYear()} | Date: ${new Date().toLocaleDateString('en-IN')}`, 40, 148);

  doc.strokeColor('#cbd5e1').lineWidth(1).moveTo(40, 163).lineTo(555, 163).stroke();

  // 4. Payee Details
  let currentY = 175;
  doc.rect(40, currentY, 515, 75).fill('#f8fafc');
  doc.strokeColor('#e2e8f0').lineWidth(1).rect(40, currentY, 515, 75).stroke();

  doc.fillColor('#1e293b').fontSize(10).font('Helvetica-Bold').text('BIDDER / CONTRACTOR DETAILS:', 50, currentY + 10);
  doc.fontSize(9).font('Helvetica')
    .text(`Company Name: ${refundRecord.company_name || 'Registered Bidder'}`, 50, currentY + 26)
    .text(`License No: ${refundRecord.license_number || 'N/A'}`, 50, currentY + 40)
    .text(`GSTIN: ${refundRecord.gst_number || 'Registered Vendor'}`, 50, currentY + 54);

  doc.font('Helvetica-Bold').text('TENDER SPECIFICATION:', 310, currentY + 10);
  doc.font('Helvetica')
    .text(`Tender Code: ${refundRecord.tender_code || 'N/A'}`, 310, currentY + 26)
    .text(`Department: ${refundRecord.department || 'Central Purchase'}`, 310, currentY + 40)
    .text(`Original Receipt #: ${refundRecord.receipt_no || 'N/A'}`, 310, currentY + 54);

  // 5. Refund Particulars Box
  currentY = 265;
  doc.rect(40, currentY, 515, 130).fill('#ffffff');
  doc.strokeColor('#cbd5e1').lineWidth(1).rect(40, currentY, 515, 130).stroke();

  doc.rect(40, currentY, 515, 24).fill(isForfeited ? '#991b1b' : '#1e3a8a');
  doc.fillColor('#ffffff').fontSize(9.5).font('Helvetica-Bold')
    .text('EMD SETTLEMENT PARTICULARS', 50, currentY + 7);

  const originalEmd = parseFloat(refundRecord.original_emd_amount || 0);
  const eligibleAmt = parseFloat(refundRecord.refund_eligible_amount || 0);

  doc.fillColor('#334155').fontSize(9).font('Helvetica')
    .text('Original EMD Security Deposit Paid:', 50, currentY + 34)
    .text(`₹ ${originalEmd.toLocaleString('en-IN')}`, 440, currentY + 34, { align: 'right' });

  doc.text('Refund Eligibility Assessment:', 50, currentY + 49)
    .text(refundRecord.eligibility_type.replace(/_/g, ' '), 440, currentY + 49, { align: 'right' });

  doc.text('Refund Settlement Status:', 50, currentY + 64)
    .text(refundRecord.refund_status, 440, currentY + 64, { align: 'right' });

  doc.strokeColor('#e2e8f0').lineWidth(0.8).moveTo(50, currentY + 80).lineTo(545, currentY + 80).stroke();

  doc.font('Helvetica-Bold').fillColor(isForfeited ? '#991b1b' : '#166534')
    .text(isForfeited ? 'Amount Forfeited to MIT:' : 'Net Refund Settled Amount:', 50, currentY + 92)
    .text(`₹ ${refundAmt.toLocaleString('en-IN')}`, 440, currentY + 92, { align: 'right' });

  doc.font('Helvetica').fontSize(8.5).fillColor('#64748b')
    .text(`Words: ${numberToWords(refundAmt)}`, 50, currentY + 110);

  // 6. Transaction & Audit Trail Box
  currentY = 410;
  doc.rect(40, currentY, 515, 95).fill('#f1f5f9');
  doc.strokeColor('#cbd5e1').lineWidth(1).rect(40, currentY, 515, 95).stroke();

  doc.fillColor('#0f172a').fontSize(9.5).font('Helvetica-Bold').text('SETTLEMENT AUDIT TRAIL:', 50, currentY + 10);
  doc.fontSize(8.5).font('Helvetica').fillColor('#334155');

  if (isForfeited) {
    doc.text(`• Forfeiture Reason: ${refundRecord.forfeiture_reason || 'Failure to comply with tender terms'}`, 50, currentY + 28, { width: 490 })
      .text(`• Approved By: ${refundRecord.approved_by_name || 'Competent Authority'}`, 50, currentY + 54)
      .text(`• Forfeiture Date: ${new Date(refundRecord.updated_at || refundRecord.created_at).toLocaleString('en-IN')}`, 310, currentY + 54);
  } else {
    doc.text(`• Execution Method: ${refundRecord.execution_type === 'RAZORPAY_GATEWAY' ? 'Automated Gateway Refund' : 'Bank Transfer / NEFT'}`, 50, currentY + 28)
      .text(`• Transaction Ref / UTR: ${refundRecord.transaction_ref || refundRecord.provider_refund_id || 'Pending'}`, 50, currentY + 44)
      .text(`• Approved By: ${refundRecord.approved_by_name || 'Central Purchase Committee'}`, 50, currentY + 60)
      .text(`• Processed Timestamp: ${refundRecord.processed_at ? new Date(refundRecord.processed_at).toLocaleString('en-IN') : 'Pending'}`, 310, currentY + 28)
      .text(`• Eligibility Date: ${new Date(refundRecord.eligibility_date || refundRecord.created_at).toLocaleDateString('en-IN')}`, 310, currentY + 44);
  }

  // 7. Signatures
  currentY = 530;
  doc.strokeColor('#cbd5e1').lineWidth(0.8).moveTo(40, currentY).lineTo(555, currentY).stroke();

  doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#334155')
    .text('Reviewed By Accounts Officer:', 60, currentY + 20)
    .text('Approved By Registrar / Competent Authority:', 330, currentY + 20);

  doc.font('Helvetica').fontSize(8).fillColor('#64748b')
    .text('MIT E-Procurement Cell', 60, currentY + 48)
    .text('Maharashtra Institute of Technology', 330, currentY + 48);

  // 8. Footnote
  doc.rect(40, 680, 515, 45).fill('#0a2540');
  doc.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold')
    .text('MAHARASHTRA INSTITUTE OF TECHNOLOGY | E-PROCUREMENT PORTAL', 50, 692);
  doc.fontSize(7.5).font('Helvetica').fillColor('#94a3b8')
    .text('Beed Bypass Road, Satara Parisar, Chhatrapati Sambhajinagar, Maharashtra - 431005 | https://mit.asia', 50, 706);

  doc.end();
}

module.exports = {
  generateContractorPaymentVoucherPdf,
  generateEmdRefundAdvicePdf
};
