const express = require('express');
const router = express.Router();
const { dbHelper } = require('../database/db');
const { verifyToken, requireRole, logAudit } = require('../middleware/auth');
const upload = require('../middleware/upload');

// Protect all contractor routes
router.use(verifyToken, requireRole('contractor', 'admin'));

// GET /api/contractor/profile
router.get('/profile', async (req, res) => {
  try {
    const contractor = await dbHelper.get(`
      SELECT c.*, u.name, u.email, u.phone, u.department
      FROM contractors c
      JOIN users u ON c.user_id = u.id
      WHERE c.user_id = ?
    `, [req.user.id]);

    if (!contractor) {
      return res.status(404).json({ success: false, message: 'Contractor business profile not found.' });
    }

    const stats = await dbHelper.get(`
      SELECT 
        COUNT(b.id) as total_bids,
        SUM(CASE WHEN b.status = 'awarded' THEN 1 ELSE 0 END) as won_tenders,
        SUM(CASE WHEN b.status = 'submitted' OR b.status = 'under_review' THEN 1 ELSE 0 END) as active_bids,
        SUM(CASE WHEN b.status = 'awarded' THEN b.bid_amount ELSE 0 END) as total_awarded_amount
      FROM bids b
      WHERE b.contractor_id = ?
    `, [contractor.id]);

    res.json({
      success: true,
      profile: contractor,
      stats: {
        totalBids: stats.total_bids || 0,
        wonTenders: stats.won_tenders || 0,
        activeBids: stats.active_bids || 0,
        totalAwardedAmount: stats.total_awarded_amount || 0
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/contractor/profile
router.put('/profile', async (req, res) => {
  try {
    const { company_name, license_number, contact_details, address, experience_years } = req.body;
    
    await dbHelper.run(`
      UPDATE contractors SET
        company_name = COALESCE(?, company_name),
        license_number = COALESCE(?, license_number),
        contact_details = COALESCE(?, contact_details),
        address = COALESCE(?, address),
        experience_years = COALESCE(?, experience_years)
      WHERE user_id = ?
    `, [company_name, license_number, contact_details, address, experience_years, req.user.id]);

    await logAudit(req.user.id, 'PROFILE_UPDATE', 'Updated vendor business credentials', req.ip);

    res.json({ success: true, message: 'Business profile updated successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/contractor/my-bids
router.get('/my-bids', async (req, res) => {
  try {
    let contractorId;
    if (req.user.role === 'contractor') {
      const contractor = await dbHelper.get('SELECT id FROM contractors WHERE user_id = ?', [req.user.id]);
      if (!contractor) {
        return res.status(404).json({ success: false, message: 'Contractor profile not found.' });
      }
      contractorId = contractor.id;
    } else {
      contractorId = req.query.contractorId;
    }

    let sql = `
      SELECT b.*, t.tender_code, t.title as tender_title, t.department, t.estimated_budget,
             t.submission_deadline, t.status as tender_status,
             (SELECT COUNT(*) FROM bid_documents WHERE bid_id = b.id) as document_count
      FROM bids b
      JOIN tenders t ON b.tender_id = t.id
      WHERE 1=1
    `;
    const params = [];
    if (contractorId) {
      sql += ' AND b.contractor_id = ?';
      params.push(contractorId);
    }
    sql += ' ORDER BY b.submission_date DESC';

    const bids = await dbHelper.all(sql, params);
    res.json({ success: true, bids });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/contractor/bids (Submit Quotation & Bid)
router.post('/bids', upload.array('documents', 5), async (req, res) => {
  try {
    const { tender_id, bid_amount, technical_proposal, remarks } = req.body;

    if (!tender_id || !bid_amount) {
      return res.status(400).json({ success: false, message: 'Tender ID and Quotation Amount are required.' });
    }

    // Get contractor ID
    const contractor = await dbHelper.get('SELECT * FROM contractors WHERE user_id = ?', [req.user.id]);
    if (!contractor) {
      return res.status(403).json({ success: false, message: 'Only registered contractors/vendors can submit bids.' });
    }

    if (contractor.registration_status !== 'approved') {
      return res.status(403).json({
        success: false,
        message: 'Your vendor account is currently pending verification by the MIT College Admin. Bid submissions will be enabled upon approval.'
      });
    }

    // Check tender status and deadline
    const tender = await dbHelper.get('SELECT * FROM tenders WHERE id = ?', [tender_id]);
    if (!tender) {
      return res.status(404).json({ success: false, message: 'Tender not found.' });
    }

    if (tender.status !== 'published') {
      return res.status(400).json({ success: false, message: `Bidding is closed for this tender (Current Status: ${tender.status}).` });
    }

    if (new Date(tender.submission_deadline) < new Date()) {
      return res.status(400).json({ success: false, message: 'The submission deadline for this tender has passed.' });
    }

    // Check if contractor already submitted a bid for this tender
    const existingBid = await dbHelper.get('SELECT id FROM bids WHERE tender_id = ? AND contractor_id = ?', [tender_id, contractor.id]);
    if (existingBid) {
      return res.status(400).json({ success: false, message: 'You have already submitted a bid for this tender.' });
    }

    const parsedBidAmount = parseFloat(bid_amount);
    if (isNaN(parsedBidAmount) || parsedBidAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Please enter a valid quotation amount.' });
    }

    // Insert bid
    const bidResult = await dbHelper.run(`
      INSERT INTO bids (tender_id, contractor_id, bid_amount, technical_proposal, remarks, status)
      VALUES (?, ?, ?, ?, ?, 'submitted')
    `, [
      tender_id,
      contractor.id,
      parsedBidAmount,
      technical_proposal || '',
      remarks || ''
    ]);

    const bidId = bidResult.lastID;

    // Handle any uploaded documents
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        await dbHelper.run(`
          INSERT INTO bid_documents (bid_id, document_type, file_name, original_name, file_path, file_size)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [
          bidId,
          'Bid Proposal Document',
          file.filename,
          file.originalname,
          `/uploads/${file.filename}`,
          file.size
        ]);
      }
    }

    await logAudit(
      req.user.id,
      'BID_SUBMIT',
      `Submitted sealed bid of ₹${parsedBidAmount.toLocaleString('en-IN')} for MIT tender #${tender_id} (${tender.tender_code})`,
      req.ip
    );

    res.status(201).json({
      success: true,
      message: 'Your sealed quotation and technical documents have been submitted successfully!',
      bidId
    });
  } catch (error) {
    console.error('Bid submission error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/contractor/bids/:id (Get single bid detail)
router.get('/bids/:id', async (req, res) => {
  try {
    const bidId = req.params.id;
    const bid = await dbHelper.get(`
      SELECT b.*, t.tender_code, t.title as tender_title, t.department, t.estimated_budget, t.submission_deadline, t.status as tender_status,
             c.company_name, c.license_number
      FROM bids b
      JOIN tenders t ON b.tender_id = t.id
      JOIN contractors c ON b.contractor_id = c.id
      WHERE b.id = ?
    `, [bidId]);

    if (!bid) {
      return res.status(404).json({ success: false, message: 'Bid not found.' });
    }

    const documents = await dbHelper.all('SELECT * FROM bid_documents WHERE bid_id = ?', [bidId]);

    res.json({
      success: true,
      bid: {
        ...bid,
        documents
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
