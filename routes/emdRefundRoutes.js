/**
 * EMD Refund Routes
 * Smart E-Tender Management System
 * Maharashtra Institute of Technology (MIT), Chhatrapati Sambhajinagar
 */

const express = require('express');
const router = express.Router();
const emdRefundController = require('../controllers/emdRefundController');
const { verifyToken, requireRole } = require('../middleware/auth');

// Base protection: All routes require valid authentication
router.use(verifyToken);

// 1. Admin Analytics
router.get(
  '/stats',
  requireRole('admin', 'authority'),
  emdRefundController.getStats
);

// 2. Admin: Paginated & Filtered All EMD Refunds
router.get(
  '/admin/all',
  requireRole('admin', 'authority'),
  emdRefundController.getAdminRefunds
);

// 3. Admin/Authority: Assess EMD Refund Eligibility for Tender
router.post(
  '/assess-eligibility',
  requireRole('admin', 'authority'),
  emdRefundController.assessEligibility
);

// 4. Admin/Authority: Approve Refund
router.post(
  '/:id/approve',
  requireRole('admin', 'authority'),
  emdRefundController.approve
);

// 5. Admin/Authority: Reject Refund with reason
router.post(
  '/:id/reject',
  requireRole('admin', 'authority'),
  emdRefundController.reject
);

// 6. Admin/Authority: Forfeit EMD with mandatory reason
router.post(
  '/:id/forfeit',
  requireRole('admin', 'authority'),
  emdRefundController.forfeit
);

// 7. Admin/Authority: Process Refund (Gateway or Manual Bank Transfer)
router.post(
  '/:id/process',
  requireRole('admin', 'authority'),
  emdRefundController.process
);

// 8. Contractor: View Own EMD Refunds
router.get(
  '/',
  emdRefundController.getContractorRefunds
);

// 9. Single Refund Detail
router.get(
  '/:id',
  emdRefundController.getRefundById
);

// 10. Audit History of Refund
router.get(
  '/:id/history',
  emdRefundController.getHistory
);

// 11. Official EMD Refund Advice PDF
router.get(
  '/:id/voucher-pdf',
  emdRefundController.getVoucherPdf
);

module.exports = router;
