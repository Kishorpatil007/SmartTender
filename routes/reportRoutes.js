const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');
const { dbHelper } = require('../database/db');
const { verifyToken } = require('../middleware/auth');

// GET /api/reports/summary (High level analytics for Chart.js and dashboards)
router.get('/summary', async (req, res) => {
  try {
    // 1. Tenders by status
    const statusCounts = await dbHelper.all(`
      SELECT status, COUNT(*) as count
      FROM tenders
      GROUP BY status
    `);

    // 2. Budget by Department
    const departmentBudgets = await dbHelper.all(`
      SELECT department, SUM(estimated_budget) as total_budget, COUNT(*) as count
      FROM tenders
      GROUP BY department
      ORDER BY total_budget DESC
    `);

    // 3. Cost Savings Analysis (on Awarded tenders)
    const savings = await dbHelper.all(`
      SELECT t.id, t.tender_code, t.title, t.estimated_budget, b.bid_amount as awarded_amount,
             (t.estimated_budget - b.bid_amount) as savings_amount,
             ROUND(((t.estimated_budget - b.bid_amount) / t.estimated_budget) * 100, 2) as savings_percent,
             c.company_name as winning_contractor
      FROM tenders t
      JOIN contractors c ON t.awarded_to_contractor_id = c.id
      JOIN bids b ON b.tender_id = t.id AND b.contractor_id = c.id
      WHERE t.status = 'awarded'
    `);

    // 4. Monthly Bidding Activity (Last 6 months)
    const monthlyActivity = await dbHelper.all(`
      SELECT strftime('%Y-%m', submission_date) as month, COUNT(*) as bid_count
      FROM bids
      GROUP BY month
      ORDER BY month ASC
    `);

    // 5. Total counts
    const overview = await dbHelper.get(`
      SELECT 
        (SELECT COUNT(*) FROM tenders) as total_tenders,
        (SELECT COUNT(*) FROM tenders WHERE status = 'published') as open_tenders,
        (SELECT COUNT(*) FROM tenders WHERE status = 'awarded') as awarded_tenders,
        (SELECT COUNT(*) FROM contractors WHERE registration_status = 'approved') as approved_contractors,
        (SELECT COUNT(*) FROM bids) as total_bids_submitted,
        (SELECT SUM(estimated_budget) FROM tenders) as total_tender_budget,
        (SELECT SUM(estimated_budget - b.bid_amount) FROM tenders t JOIN bids b ON b.tender_id = t.id AND b.status = 'awarded') as total_savings
      FROM users LIMIT 1
    `);

    res.json({
      success: true,
      data: {
        overview,
        statusCounts,
        departmentBudgets,
        savings,
        monthlyActivity
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/reports/tender-history
router.get('/tender-history', async (req, res) => {
  try {
    const history = await dbHelper.all(`
      SELECT t.*, u.name as created_by_name, c.company_name as winner_name,
             (SELECT COUNT(*) FROM bids WHERE tender_id = t.id) as total_bidders,
             (SELECT MIN(bid_amount) FROM bids WHERE tender_id = t.id) as lowest_bid,
             (SELECT bid_amount FROM bids WHERE tender_id = t.id AND status = 'awarded') as awarded_amount
      FROM tenders t
      LEFT JOIN users u ON t.created_by = u.id
      LEFT JOIN contractors c ON t.awarded_to_contractor_id = c.id
      ORDER BY t.created_at DESC
    `);

    res.json({ success: true, history });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/reports/contractor-performance
router.get('/contractor-performance', async (req, res) => {
  try {
    const performance = await dbHelper.all(`
      SELECT c.id, c.company_name, c.license_number, c.experience_years, c.registration_status,
             COUNT(b.id) as total_bids_submitted,
             SUM(CASE WHEN b.status = 'awarded' THEN 1 ELSE 0 END) as tenders_won,
             ROUND(AVG(b.technical_score), 2) as avg_technical_score,
             SUM(CASE WHEN b.status = 'awarded' THEN b.bid_amount ELSE 0 END) as total_contract_value
      FROM contractors c
      LEFT JOIN bids b ON b.contractor_id = c.id
      GROUP BY c.id
      ORDER BY tenders_won DESC, total_contract_value DESC
    `);

    const formatted = performance.map(p => ({
      ...p,
      win_rate: p.total_bids_submitted > 0 ? ((p.tenders_won / p.total_bids_submitted) * 100).toFixed(1) + '%' : '0.0%'
    }));

    res.json({ success: true, performance: formatted });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/reports/tender/:id/pdf (Generate Official MIT College PDF Document)
router.get('/tender/:id/pdf', async (req, res) => {
  try {
    const tenderId = req.params.id;
    const type = req.query.type || 'comparative'; // 'comparative' or 'award'

    const tender = await dbHelper.get(`
      SELECT t.*, u.name as created_by_name, u.department as creator_department,
             c.company_name as winner_name, c.license_number as winner_license, c.address as winner_address,
             b.bid_amount as winning_amount
      FROM tenders t
      LEFT JOIN users u ON t.created_by = u.id
      LEFT JOIN contractors c ON t.awarded_to_contractor_id = c.id
      LEFT JOIN bids b ON b.tender_id = t.id AND b.contractor_id = c.id
      WHERE t.id = ?
    `, [tenderId]);

    if (!tender) {
      return res.status(404).json({ success: false, message: 'Tender record not found' });
    }

    const bids = await dbHelper.all(`
      SELECT b.*, c.company_name, c.license_number, e.technical_score as eval_tech_score
      FROM bids b
      JOIN contractors c ON b.contractor_id = c.id
      LEFT JOIN evaluations e ON b.id = e.bid_id
      WHERE b.tender_id = ?
      ORDER BY b.bid_amount ASC
    `, [tenderId]);

    // Create PDF
    const doc = new PDFDocument({ margin: 40, size: 'A4' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${tender.tender_code}_report.pdf"`);
    doc.pipe(res);

    // MIT College Header Banner
    doc.rect(0, 0, 595.28, 85).fill('#0a2540');
    doc.fillColor('#ffffff').fontSize(15).font('Helvetica-Bold').text('MAHARASHTRA INSTITUTE OF TECHNOLOGY (MIT)', 40, 20);
    doc.fontSize(10).font('Helvetica').text('CHHATRAPATI SAMBHAJINAGAR, MAHARASHTRA - 431005', 40, 40);
    doc.fontSize(8.5).font('Helvetica-Oblique').fillColor('#93c5fd').text('Central Purchase Committee | E-Tendering & Procurement Cell', 40, 56);

    doc.moveDown(3);
    doc.fillColor('#2d3748');

    if (type === 'award' && tender.status === 'awarded') {
      // OFFICIAL LETTER OF AWARD (LOA)
      doc.fontSize(14).font('Helvetica-Bold').fillColor('#1a56db').text('OFFICIAL LETTER OF AWARD & ACCEPTANCE (LOA)', 40, 110);
      doc.fontSize(9).font('Helvetica').fillColor('#718096').text(`Ref No: MIT/PUR/LOA/${tender.tender_code}/${new Date().getFullYear()} | Date: ${new Date().toLocaleDateString('en-IN')}`, 40, 130);
      doc.strokeColor('#cbd5e1').lineWidth(1).moveTo(40, 145).lineTo(555, 145).stroke();

      doc.moveDown(3);
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#2d3748').text('TO:', 40, 160);
      doc.font('Helvetica').text(`M/s ${tender.winner_name || 'Winning Contractor'}`);
      doc.text(`License/GSTIN No: ${tender.winner_license || 'N/A'}`);
      doc.text(`Registered Address: ${tender.winner_address || 'Chhatrapati Sambhajinagar, Maharashtra'}`);

      doc.moveDown(1.2);
      doc.font('Helvetica-Bold').text(`SUBJECT: Award of Contract for ${tender.tender_code} - ${tender.title}`);
      
      doc.moveDown(1);
      doc.font('Helvetica').fontSize(9.5).text(
        `Dear Sir/Madam,\n\nWe are pleased to inform you that following the thorough evaluation of sealed bids conducted by the MIT Purchase and Technical Evaluation Committee for Tender Ref: ${tender.tender_code} ("${tender.title}"), your commercial quote amounting to ₹${(tender.winning_amount || 0).toLocaleString('en-IN')} (Inclusive of applicable duties and statutory taxes) has been formally accepted by the Competent College Authority.`,
        { align: 'justify', lineGap: 3 }
      );

      doc.moveDown(1);
      doc.font('Helvetica-Bold').fontSize(10).text('SUMMARY OF AWARDED CONTRACT:');
      doc.font('Helvetica').fontSize(9).text(`• Tender Reference: ${tender.tender_code}`);
      doc.text(`• Indenting Department: ${tender.department}`);
      doc.text(`• College Estimated Budget: ₹${tender.estimated_budget.toLocaleString('en-IN')}`);
      doc.text(`• Final Accepted Contract Value: ₹${(tender.winning_amount || 0).toLocaleString('en-IN')}`);
      doc.text(`• Earnest Money Deposit (EMD) / Security: ₹${tender.emd_amount.toLocaleString('en-IN')}`);

      doc.moveDown(1.5);
      doc.text(
        'You are hereby advised to submit the Performance Bank Guarantee (PBG) equivalent to 5% of the total contract value and execute the formal Contract Agreement on ₹500 non-judicial stamp paper within 10 working days from the date of issuance of this Letter of Award.',
        { align: 'justify' }
      );

      doc.moveDown(3);
      doc.font('Helvetica-Bold').text('By Order of the Competent Authority,');
      doc.font('Helvetica').text('Registrar / Competent Procurement Authority');
      doc.text('Central Administration & Purchase Committee');
      doc.text('Maharashtra Institute of Technology (MIT), Chhatrapati Sambhajinagar');

    } else {
      // BID COMPARATIVE STATEMENT REPORT
      doc.fontSize(14).font('Helvetica-Bold').fillColor('#1a56db').text('BID COMPARATIVE STATEMENT & EVALUATION REPORT', 40, 110);
      doc.fontSize(9).font('Helvetica').fillColor('#718096').text(`Tender Ref: ${tender.tender_code} | Generated on: ${new Date().toLocaleDateString('en-IN')}`, 40, 130);
      doc.strokeColor('#cbd5e1').lineWidth(1).moveTo(40, 145).lineTo(555, 145).stroke();

      doc.moveDown(3);
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#2d3748').text('COLLEGE TENDER SPECIFICATIONS:', 40, 160);
      doc.font('Helvetica').fontSize(9).text(`Title: ${tender.title}`);
      doc.text(`Department: ${tender.department}`);
      doc.text(`Estimated Allocation Budget: ₹${tender.estimated_budget.toLocaleString('en-IN')}`);
      doc.text(`EMD Amount: ₹${tender.emd_amount.toLocaleString('en-IN')}`);
      doc.text(`Procurement Lifecycle Status: ${tender.status.toUpperCase()}`);

      doc.moveDown(1.5);
      doc.fontSize(10.5).font('Helvetica-Bold').text('CONTRACTOR BID COMPARISON TABLE (L1 MATRIX):');
      doc.moveDown(0.5);

      // Table Header
      let y = doc.y;
      doc.rect(40, y, 515, 20).fill('#edf2f7');
      doc.fillColor('#2d3748').fontSize(8.5).font('Helvetica-Bold');
      doc.text('Rank', 45, y + 5);
      doc.text('Contractor / Vendor Name', 85, y + 5);
      doc.text('Quoted Price (INR)', 270, y + 5);
      doc.text('Tech Score', 390, y + 5);
      doc.text('Status', 470, y + 5);

      y += 22;
      doc.font('Helvetica').fontSize(8.5);

      if (bids.length === 0) {
        doc.fillColor('#718096').text('No bids submitted for this tender yet.', 45, y + 5);
        y += 20;
      } else {
        bids.forEach((bid, idx) => {
          const isLowest = idx === 0;
          doc.rect(40, y, 515, 18).fill(idx % 2 === 0 ? '#ffffff' : '#f8fafc');
          doc.fillColor(isLowest ? '#1a56db' : '#2d3748');
          doc.text(`L${idx + 1}`, 45, y + 4);
          doc.text(bid.company_name.substring(0, 32), 85, y + 4);
          doc.text(`₹${bid.bid_amount.toLocaleString('en-IN')}`, 270, y + 4);
          doc.text(`${bid.technical_score || bid.eval_tech_score || 'N/A'}/100`, 390, y + 4);
          doc.text(bid.status.toUpperCase(), 470, y + 4);
          y += 18;
        });
      }

      doc.y = y + 15;
      doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#2d3748').text('PURCHASE & EVALUATION COMMITTEE AUDIT REMARKS:');
      doc.font('Helvetica').fontSize(8.5).text(
        tender.award_notes || 'All submitted bids were verified against statutory compliance, technical specifications, and OEM credentials. The L1 quote has been evaluated and found to be economically viable and compliant with MIT College procurement guidelines.',
        { align: 'justify', lineGap: 2 }
      );
    }

    // Footer
    doc.fontSize(8).fillColor('#a0aec0').text('Maharashtra Institute of Technology (MIT), Chhatrapati Sambhajinagar - Confidential E-Procurement Document', 40, 780, { align: 'center' });

    doc.end();
  } catch (error) {
    console.error('PDF error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
