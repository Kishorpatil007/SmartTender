const express = require('express');
const router = express.Router();
const { dbHelper } = require('../database/db');
const { verifyToken, requireRole, logAudit } = require('../middleware/auth');

// Allow evaluator, authority, and admin
router.use(verifyToken, requireRole('evaluator', 'authority', 'admin'));

// GET /api/evaluation/tenders
router.get('/tenders', async (req, res) => {
  try {
    const tenders = await dbHelper.all(`
      SELECT t.*, u.name as created_by_name,
             c.company_name as awarded_contractor_name,
             (SELECT COUNT(*) FROM bids WHERE tender_id = t.id) as total_bids,
             (SELECT COUNT(*) FROM evaluations WHERE tender_id = t.id) as total_evaluations
      FROM tenders t
      LEFT JOIN users u ON t.created_by = u.id
      LEFT JOIN contractors c ON t.awarded_to_contractor_id = c.id
      WHERE t.status IN ('under_evaluation', 'awarded', 'published')
      ORDER BY 
        CASE t.status
          WHEN 'under_evaluation' THEN 1
          WHEN 'published' THEN 2
          WHEN 'awarded' THEN 3
          ELSE 4
        END,
        t.submission_deadline ASC
    `);

    res.json({ success: true, tenders });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/evaluation/tenders/:tenderId/bids (Comparative Table Data)
router.get('/tenders/:tenderId/bids', async (req, res) => {
  try {
    const tenderId = req.params.tenderId;
    const tender = await dbHelper.get('SELECT * FROM tenders WHERE id = ?', [tenderId]);
    if (!tender) {
      return res.status(404).json({ success: false, message: 'Tender not found.' });
    }

    const bids = await dbHelper.all(`
      SELECT b.*, c.company_name, c.license_number, c.contact_details, c.experience_years,
             u.name as contractor_name, u.email as contractor_email,
             e.technical_score as eval_technical_score, e.financial_score as eval_financial_score,
             e.comments as eval_comments, e.recommendation as eval_recommendation,
             e.evaluated_at, eu.name as evaluator_name
      FROM bids b
      JOIN contractors c ON b.contractor_id = c.id
      JOIN users u ON c.user_id = u.id
      LEFT JOIN evaluations e ON b.id = e.bid_id
      LEFT JOIN users eu ON e.evaluator_id = eu.id
      WHERE b.tender_id = ?
      ORDER BY b.bid_amount ASC
    `, [tenderId]);

    // Retrieve documents for each bid
    for (const bid of bids) {
      bid.documents = await dbHelper.all('SELECT * FROM bid_documents WHERE bid_id = ?', [bid.id]);
    }

    // Calculate comparative metrics:
    // 1. Find lowest bid
    const validBids = bids.filter(b => b.status !== 'disqualified' && b.bid_amount > 0);
    const minBidAmount = validBids.length > 0 ? Math.min(...validBids.map(b => b.bid_amount)) : 0;

    // 2. Compute lowest bid rank and automated financial/QCBS scores
    const comparativeBids = bids.map((b, index) => {
      const isL1 = b.bid_amount === minBidAmount;
      const budgetDeviation = tender.estimated_budget > 0
        ? (((b.bid_amount - tender.estimated_budget) / tender.estimated_budget) * 100).toFixed(2)
        : 0;
      
      // Auto Financial Score formula: (Lowest Bid / Bid Amount) * 100
      const autoFinancialScore = minBidAmount > 0 ? ((minBidAmount / b.bid_amount) * 100).toFixed(2) : 0;

      // Combined QCBS (70% Technical, 30% Financial)
      const techScore = b.eval_technical_score || b.technical_score || 0;
      const finScore = b.eval_financial_score || parseFloat(autoFinancialScore);
      const combinedScore = ((techScore * 0.7) + (finScore * 0.3)).toFixed(2);

      return {
        ...b,
        is_l1: isL1,
        financial_rank: `Rank ${index + 1}`,
        budget_deviation_percent: budgetDeviation,
        auto_financial_score: parseFloat(autoFinancialScore),
        computed_combined_score: parseFloat(combinedScore)
      };
    });

    res.json({
      success: true,
      tender,
      minBidAmount,
      bids: comparativeBids
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/evaluation/score (Score a Bid)
router.post('/score', async (req, res) => {
  try {
    const { bid_id, technical_score, financial_score, compliance_checked, comments, recommendation } = req.body;

    if (!bid_id || technical_score === undefined) {
      return res.status(400).json({ success: false, message: 'Bid ID and technical evaluation score are required.' });
    }

    const bid = await dbHelper.get('SELECT * FROM bids WHERE id = ?', [bid_id]);
    if (!bid) {
      return res.status(404).json({ success: false, message: 'Bid not found.' });
    }

    const tScore = parseFloat(technical_score);
    const fScore = financial_score !== undefined ? parseFloat(financial_score) : (bid.financial_score || 100);
    const totalScore = ((tScore * 0.7) + (fScore * 0.3)).toFixed(2);

    // Insert or update evaluation
    await dbHelper.run(`
      INSERT INTO evaluations (
        tender_id, bid_id, evaluator_id, technical_score, financial_score,
        compliance_checked, comments, recommendation, evaluated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (bid_id, evaluator_id) DO UPDATE SET
        technical_score = EXCLUDED.technical_score,
        financial_score = EXCLUDED.financial_score,
        compliance_checked = EXCLUDED.compliance_checked,
        comments = EXCLUDED.comments,
        recommendation = EXCLUDED.recommendation,
        evaluated_at = CURRENT_TIMESTAMP
    `, [
      bid.tender_id,
      bid_id,
      req.user.id,
      tScore,
      fScore,
      Boolean(compliance_checked),
      comments || '',
      recommendation || 'acceptable'
    ]);

    // Update bid table with scores
    const newStatus = tScore >= 70 ? 'qualified' : 'disqualified';
    await dbHelper.run(`
      UPDATE bids SET
        technical_score = ?,
        financial_score = ?,
        total_score = ?,
        status = ?,
        remarks = COALESCE(?, remarks)
      WHERE id = ?
    `, [tScore, fScore, parseFloat(totalScore), newStatus, comments, bid_id]);

    await logAudit(
      req.user.id,
      'BID_EVALUATION',
      `Evaluated Bid #${bid_id} on MIT Tender #${bid.tender_id}: Technical: ${tScore}, Financial: ${fScore}, QCBS Total: ${totalScore} (${newStatus})`,
      req.ip
    );

    res.json({
      success: true,
      message: 'Bid evaluation score and compliance notes recorded successfully!',
      scores: {
        technical_score: tScore,
        financial_score: fScore,
        total_score: parseFloat(totalScore),
        status: newStatus
      }
    });
  } catch (error) {
    console.error('Score submission error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/evaluation/award (Award Tender to Winning Contractor)
router.post('/award', verifyToken, requireRole('authority', 'admin', 'evaluator'), async (req, res) => {
  try {
    const { tender_id, bid_id, award_notes } = req.body;

    if (!tender_id || !bid_id) {
      return res.status(400).json({ success: false, message: 'Tender ID and Winning Bid ID are required.' });
    }

    const tender = await dbHelper.get('SELECT * FROM tenders WHERE id = ?', [tender_id]);
    if (!tender) {
      return res.status(404).json({ success: false, message: 'Tender not found.' });
    }

    const bid = await dbHelper.get(`
      SELECT b.*, c.company_name, c.id as contractor_id
      FROM bids b
      JOIN contractors c ON b.contractor_id = c.id
      WHERE b.id = ? AND b.tender_id = ?
    `, [bid_id, tender_id]);

    if (!bid) {
      return res.status(404).json({ success: false, message: 'Winning bid not found for this tender.' });
    }

    // 1. Update tender status to 'awarded' and set winner
    await dbHelper.run(`
      UPDATE tenders SET
        status = 'awarded',
        awarded_to_contractor_id = ?,
        award_date = CURRENT_TIMESTAMP,
        award_notes = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [bid.contractor_id, award_notes || `Approved by MIT Purchase Committee. Awarded to ${bid.company_name} at accepted quote of ₹${bid.bid_amount.toLocaleString('en-IN')}.`, tender_id]);

    // 2. Update winning bid to 'awarded'
    await dbHelper.run("UPDATE bids SET status = 'awarded' WHERE id = ?", [bid_id]);

    // 3. Update other bids on this tender to 'rejected'
    await dbHelper.run("UPDATE bids SET status = 'rejected' WHERE tender_id = ? AND id != ?", [tender_id, bid_id]);

    await logAudit(
      req.user.id,
      'TENDER_AWARD',
      `Awarded MIT Tender #${tender_id} (${tender.tender_code}) to ${bid.company_name} (Bid #${bid_id}, ₹${bid.bid_amount.toLocaleString('en-IN')})`,
      req.ip
    );

    // 4. Automatically initialize contractor payment milestone and assess EMD refund eligibility
    try {
      const contractorPaymentService = require('../services/contractorPaymentService');
      const emdRefundService = require('../services/emdRefundService');
      await contractorPaymentService.initializeContractPayment({
        tenderId: parseInt(tender_id, 10),
        adminUserId: req.user.id,
        ipAddress: req.ip
      });
      await emdRefundService.assessEligibilityForTender({
        tenderId: parseInt(tender_id, 10),
        userId: req.user.id,
        ipAddress: req.ip
      });
    } catch (postAwardErr) {
      console.warn('Post-award payment/refund automation notice:', postAwardErr.message);
    }

    res.json({
      success: true,
      message: `Tender ${tender.tender_code} has been successfully awarded to ${bid.company_name}!`,
      awardedContractor: bid.company_name,
      awardAmount: bid.bid_amount
    });
  } catch (error) {
    console.error('Award error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
