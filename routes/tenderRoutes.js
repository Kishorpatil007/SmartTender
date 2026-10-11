const express = require('express');
const router = express.Router();
const path = require('path');
const { dbHelper } = require('../database/db');
const { verifyToken, requireRole, logAudit } = require('../middleware/auth');
const upload = require('../middleware/upload');

// GET /api/tenders (Public or Filtered)
router.get('/', async (req, res) => {
  try {
    const { status, department, search, minBudget, maxBudget } = req.query;
    let sql = `
      SELECT t.*, u.name as created_by_name,
             c.company_name as awarded_contractor_name,
             (SELECT COUNT(*) FROM bids WHERE tender_id = t.id) as total_bids,
             (SELECT COUNT(*) FROM tender_documents WHERE tender_id = t.id) as total_documents
      FROM tenders t
      LEFT JOIN users u ON t.created_by = u.id
      LEFT JOIN contractors c ON t.awarded_to_contractor_id = c.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      sql += ' AND t.status = ?';
      params.push(status);
    }
    if (department) {
      sql += ' AND t.department = ?';
      params.push(department);
    }
    if (minBudget) {
      sql += ' AND t.estimated_budget >= ?';
      params.push(parseFloat(minBudget));
    }
    if (maxBudget) {
      sql += ' AND t.estimated_budget <= ?';
      params.push(parseFloat(maxBudget));
    }
    if (search) {
      sql += ' AND (t.title LIKE ? OR t.tender_code LIKE ? OR t.description LIKE ? OR t.department LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    sql += ' ORDER BY t.created_at DESC';
    const tenders = await dbHelper.all(sql, params);

    res.json({ success: true, tenders });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/tenders/:id (Detail view)
router.get('/:id', async (req, res) => {
  try {
    const tenderId = req.params.id;
    const tender = await dbHelper.get(`
      SELECT t.*, u.name as created_by_name, u.email as created_by_email,
             c.company_name as awarded_contractor_name, c.license_number as awarded_contractor_license
      FROM tenders t
      LEFT JOIN users u ON t.created_by = u.id
      LEFT JOIN contractors c ON t.awarded_to_contractor_id = c.id
      WHERE t.id = ?
    `, [tenderId]);

    if (!tender) {
      return res.status(404).json({ success: false, message: 'Tender not found.' });
    }

    // Get documents
    const documents = await dbHelper.all('SELECT * FROM tender_documents WHERE tender_id = ? ORDER BY uploaded_at ASC', [tenderId]);

    // Check if bids exist
    const bidStats = await dbHelper.get(`
      SELECT COUNT(*) as count, MIN(bid_amount) as min_bid, MAX(bid_amount) as max_bid, AVG(bid_amount) as avg_bid
      FROM bids WHERE tender_id = ?
    `, [tenderId]);

    res.json({
      success: true,
      tender: {
        ...tender,
        documents,
        bidStats
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/tenders (Create new college procurement tender with optional specification document)
router.post('/', verifyToken, requireRole('authority', 'admin'), upload.single('document'), async (req, res) => {
  try {
    const {
      title,
      description,
      department,
      estimated_budget,
      emd_amount,
      submission_deadline,
      opening_date,
      eligibility_criteria,
      status
    } = req.body;

    if (!title || !department || !estimated_budget || !submission_deadline || !opening_date) {
      return res.status(400).json({ success: false, message: 'Title, college department, budget, submission deadline, and opening date are required.' });
    }

    // Generate unique MIT college tender code (MIT-TND-YYYY-XXX)
    const datePart = new Date().getFullYear();
    const countRow = await dbHelper.get('SELECT COUNT(*) as count FROM tenders');
    const seq = String(countRow.count + 1).padStart(3, '0');
    const tender_code = `MIT-TND-${datePart}-${seq}`;

    const tenderStatus = status || 'draft';

    const result = await dbHelper.run(`
      INSERT INTO tenders (
        tender_code, title, description, department, estimated_budget,
        emd_amount, submission_deadline, opening_date, eligibility_criteria,
        status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      tender_code,
      title,
      description || '',
      department,
      parseFloat(estimated_budget),
      parseFloat(emd_amount || 0),
      submission_deadline,
      opening_date,
      eligibility_criteria || '',
      tenderStatus,
      req.user.id
    ]);

    const tenderId = result.lastID;

    // If file was attached during creation, insert tender document
    let uploadedDocument = null;
    if (req.file) {
      const relativePath = `/uploads/${req.file.filename}`;
      const docResult = await dbHelper.run(`
        INSERT INTO tender_documents (tender_id, file_name, original_name, file_path, file_type, file_size)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        tenderId,
        req.file.filename,
        req.file.originalname,
        relativePath,
        req.file.mimetype,
        req.file.size
      ]);

      uploadedDocument = {
        id: docResult.lastID,
        file_name: req.file.filename,
        original_name: req.file.originalname,
        file_path: relativePath,
        file_size: req.file.size
      };
    }

    await logAudit(
      req.user.id,
      'TENDER_CREATE',
      `Created MIT tender ${tender_code}: "${title}" for ${department} with budget ₹${parseFloat(estimated_budget).toLocaleString('en-IN')} (${tenderStatus})${req.file ? ` with attached document: ${req.file.originalname}` : ''}`,
      req.ip
    );

    res.status(201).json({
      success: true,
      message: 'College procurement tender created successfully!',
      tenderId,
      tenderCode: tender_code,
      document: uploadedDocument
    });
  } catch (error) {
    console.error('Tender creation error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/tenders/:id (Update tender)
router.put('/:id', verifyToken, requireRole('authority', 'admin'), async (req, res) => {
  try {
    const tenderId = req.params.id;
    const {
      title,
      description,
      department,
      estimated_budget,
      emd_amount,
      submission_deadline,
      opening_date,
      eligibility_criteria,
      status
    } = req.body;

    const tender = await dbHelper.get('SELECT * FROM tenders WHERE id = ?', [tenderId]);
    if (!tender) {
      return res.status(404).json({ success: false, message: 'Tender not found.' });
    }

    if (tender.status === 'awarded') {
      return res.status(400).json({ success: false, message: 'Cannot modify an already awarded tender.' });
    }

    await dbHelper.run(`
      UPDATE tenders SET
        title = COALESCE(?, title),
        description = COALESCE(?, description),
        department = COALESCE(?, department),
        estimated_budget = COALESCE(?, estimated_budget),
        emd_amount = COALESCE(?, emd_amount),
        submission_deadline = COALESCE(?, submission_deadline),
        opening_date = COALESCE(?, opening_date),
        eligibility_criteria = COALESCE(?, eligibility_criteria),
        status = COALESCE(?, status),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      title,
      description,
      department,
      estimated_budget ? parseFloat(estimated_budget) : null,
      emd_amount ? parseFloat(emd_amount) : null,
      submission_deadline,
      opening_date,
      eligibility_criteria,
      status,
      tenderId
    ]);

    await logAudit(req.user.id, 'TENDER_UPDATE', `Updated MIT tender #${tenderId} (${tender.tender_code})`, req.ip);

    res.json({ success: true, message: 'Tender details updated successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/tenders/:id/publish (Publish tender)
router.put('/:id/publish', verifyToken, requireRole('authority', 'admin'), async (req, res) => {
  try {
    const tenderId = req.params.id;
    await dbHelper.run("UPDATE tenders SET status = 'published', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [tenderId]);
    await logAudit(req.user.id, 'TENDER_PUBLISH', `Published tender #${tenderId} to MIT portal`, req.ip);
    res.json({ success: true, message: 'Tender published successfully! Now open for contractor bidding.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/tenders/:id/close-bidding (Move to under_evaluation)
router.put('/:id/close-bidding', verifyToken, requireRole('authority', 'admin'), async (req, res) => {
  try {
    const tenderId = req.params.id;
    await dbHelper.run("UPDATE tenders SET status = 'under_evaluation', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [tenderId]);
    await logAudit(req.user.id, 'TENDER_CLOSE_BIDDING', `Closed bidding for tender #${tenderId}, forwarded to Purchase Evaluation Committee.`, req.ip);
    res.json({ success: true, message: 'Bidding closed. Tender moved to evaluation phase.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/tenders/:id/documents (Upload document to tender)
router.post('/:id/documents', verifyToken, requireRole('authority', 'admin'), upload.single('document'), async (req, res) => {
  try {
    const tenderId = req.params.id;
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No document uploaded.' });
    }

    const relativePath = `/uploads/${req.file.filename}`;
    const result = await dbHelper.run(`
      INSERT INTO tender_documents (tender_id, file_name, original_name, file_path, file_type, file_size)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      tenderId,
      req.file.filename,
      req.file.originalname,
      relativePath,
      req.file.mimetype,
      req.file.size
    ]);

    await logAudit(req.user.id, 'DOCUMENT_UPLOAD', `Uploaded document "${req.file.originalname}" to MIT tender #${tenderId}`, req.ip);

    res.status(201).json({
      success: true,
      message: 'Official specification document uploaded successfully.',
      document: {
        id: result.lastID,
        file_name: req.file.filename,
        original_name: req.file.originalname,
        file_path: relativePath,
        file_size: req.file.size
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/tenders/:id (Delete draft tender)
router.delete('/:id', verifyToken, requireRole('authority', 'admin'), async (req, res) => {
  try {
    const tenderId = req.params.id;
    const tender = await dbHelper.get('SELECT * FROM tenders WHERE id = ?', [tenderId]);
    if (!tender) {
      return res.status(404).json({ success: false, message: 'Tender not found.' });
    }

    if (tender.status === 'awarded') {
      return res.status(400).json({ success: false, message: 'Cannot delete an awarded tender.' });
    }

    await dbHelper.run('DELETE FROM tenders WHERE id = ?', [tenderId]);
    await logAudit(req.user.id, 'TENDER_DELETE', `Deleted tender ${tender.tender_code}`, req.ip);

    res.json({ success: true, message: 'Draft tender deleted successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
