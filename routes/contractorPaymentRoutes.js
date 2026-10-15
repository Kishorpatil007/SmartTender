/**
 * Contractor Payment Routes
 * Smart E-Tender Management System
 * Maharashtra Institute of Technology (MIT), Chhatrapati Sambhajinagar
 */

const express = require('express');
const router = express.Router();
const contractorPaymentController = require('../controllers/contractorPaymentController');
const { verifyToken, requireRole } = require('../middleware/auth');
const upload = require('../middleware/upload');

// Base protection: All routes require valid authentication
router.use(verifyToken);

// 1. Awarded Tenders for Contract Payment Setup
router.get(
  '/awarded-tenders',
  contractorPaymentController.getAwardedTenders
);

// 2. Admin Analytics
router.get(
  '/stats',
  requireRole('admin', 'authority'),
  contractorPaymentController.getStats
);

// 3. Admin: Paginated & Filtered All Claims
router.get(
  '/admin/all',
  requireRole('admin', 'authority'),
  contractorPaymentController.getAdminPayments
);

// 4. Admin/Authority: Initialize Contract Record for an Awarded Tender
router.post(
  '/initialize',
  requireRole('admin', 'authority'),
  contractorPaymentController.initialize
);

// 5. Contractor: Submit Work Completion & Invoice Claim (Upload evidence and invoice)
router.post(
  '/claims',
  requireRole('contractor'),
  upload.fields([
    { name: 'evidence', maxCount: 1 },
    { name: 'invoice', maxCount: 1 }
  ]),
  contractorPaymentController.submitClaim
);

// 6. Authority/Admin: Update Work Status (e.g. work_in_progress, inspection_pending)
router.post(
  '/:id/work-status',
  requireRole('admin', 'authority'),
  contractorPaymentController.updateWorkStatus
);

// 7. Authority/Admin: Inspect Work (Approve or Reject Inspection)
router.post(
  '/:id/inspect',
  requireRole('admin', 'authority'),
  contractorPaymentController.inspectWork
);

// 8. Authority/Admin: Approve Payment Claim (Set deductions, tax, retention)
router.post(
  '/:id/approve',
  requireRole('admin', 'authority'),
  contractorPaymentController.approveClaim
);

// 9. Authority/Admin: Reject Payment Claim with reason
router.post(
  '/:id/reject',
  requireRole('admin', 'authority'),
  contractorPaymentController.rejectClaim
);

// 10. Authority/Admin: Record Manual/External Bank Transfer Payment
router.post(
  '/:id/record-payment',
  requireRole('admin', 'authority'),
  upload.single('supporting_doc'),
  contractorPaymentController.recordPayment
);

// 11. Contractor Payments List (For contractor, returns own claims; for admin, supports query params)
router.get(
  '/',
  contractorPaymentController.getContractorPayments
);

// 12. Single Contract Payment Record Detail
router.get(
  '/:id',
  contractorPaymentController.getPaymentById
);

// 13. Audit & Transaction History
router.get(
  '/:id/history',
  contractorPaymentController.getPaymentHistory
);

// 14. Official Disbursement Voucher PDF
router.get(
  '/:id/voucher-pdf',
  contractorPaymentController.getVoucherPdf
);

module.exports = router;
