const express = require('express');
const router = express.Router();
const { dbHelper } = require('../database/db');

// Helper to format currency
const formatUSD = (num) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(num).replace('₹', '₹ ');
};

// GET /api/ai/suggestions
router.get('/suggestions', async (req, res) => {
  try {
    const publishedTenders = await dbHelper.all("SELECT tender_code, title, department FROM tenders WHERE status = 'published' LIMIT 3");
    
    const suggestions = [
      "Show all active tenders for MIT College",
      "What is the eligibility criteria for the AI Lab HPC Cluster tender?",
      "How do contractors submit sealed bids on this portal?",
      "What is the L1 lowest bidder calculation formula?",
      "What documents are required for contractor registration?"
    ];

    if (publishedTenders.length > 0) {
      suggestions.unshift(`Tell me about ${publishedTenders[0].tender_code} (${publishedTenders[0].department})`);
    }

    res.json({ success: true, suggestions });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/ai/chat
router.post('/chat', async (req, res) => {
  try {
    const { message, history } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ success: false, message: 'Message text is required.' });
    }

    const query = message.toLowerCase().trim();

    // 1. Fetch live database state for accurate responses
    const allTenders = await dbHelper.all(`
      SELECT t.*, u.name as created_by_name,
             (SELECT COUNT(*) FROM bids WHERE tender_id = t.id) as bid_count
      FROM tenders t
      LEFT JOIN users u ON t.created_by = u.id
      ORDER BY t.created_at DESC
    `);

    const openTenders = allTenders.filter(t => t.status === 'published');
    const underEvalTenders = allTenders.filter(t => t.status === 'under_evaluation');
    const awardedTenders = allTenders.filter(t => t.status === 'awarded');

    let responseText = '';
    let relatedTenders = [];

    // 2. Intelligent NLP / Context Matching Engine

    // Case A: Specific Tender Code / Keywords in Database
    const matchedTender = allTenders.find(t => 
      query.includes(t.tender_code.toLowerCase()) || 
      (query.includes('hpc') || query.includes('gpu') || query.includes('ai cluster') ? t.tender_code.includes('001') : false) ||
      (query.includes('wifi') || query.includes('wi-fi') || query.includes('fiber') || query.includes('network') ? t.tender_code.includes('002') : false) ||
      (query.includes('auditorium') || query.includes('acoustic') ? t.tender_code.includes('003') : false) ||
      (query.includes('solar') || query.includes('amc') || query.includes('dg set') ? t.tender_code.includes('004') : false) ||
      (query.includes('robotics') || query.includes('cnc') || query.includes('fablab') ? t.tender_code.includes('005') : false)
    );

    if (matchedTender) {
      relatedTenders.push(matchedTender);
      const isPast = new Date(matchedTender.submission_deadline) < new Date();
      
      responseText = `### 📋 **${matchedTender.tender_code}: ${matchedTender.title}**\n\n` +
        `- **Department:** ${matchedTender.department}\n` +
        `- **Estimated Budget:** ₹${matchedTender.estimated_budget.toLocaleString('en-IN')}\n` +
        `- **EMD (Earnest Money Deposit):** ₹${matchedTender.emd_amount.toLocaleString('en-IN')}\n` +
        `- **Current Status:** \`${matchedTender.status.toUpperCase()}\`\n` +
        `- **Submission Deadline:** ${new Date(matchedTender.submission_deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}\n` +
        `- **Bid Opening Date:** ${new Date(matchedTender.opening_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}\n\n` +
        `**Mandatory Eligibility Criteria:**\n` +
        `> ${matchedTender.eligibility_criteria || 'Statutory GSTIN, PAN, and OEM authorization required.'}\n\n` +
        `**Project Scope Summary:**\n` +
        `${matchedTender.description}\n\n` +
        (matchedTender.status === 'published' && !isPast 
          ? `💡 *You can click **"View & Bid"** in the Public Directory to submit a sealed quotation before the deadline.*`
          : `⚠️ *Bidding for this tender is currently ${matchedTender.status.replace('_', ' ')}.*`);

    // Case B: List Active / Open Tenders
    } else if (query.includes('active') || query.includes('open') || query.includes('available') || query.includes('list tender') || query.includes('all tender') || query.includes('what tenders') || query.includes('current tender')) {
      if (openTenders.length === 0) {
        responseText = `Currently, there are no published tenders open for new bidding at **Maharashtra Institute of Technology (MIT), Chhatrapati Sambhajinagar**.\n\n` +
          `Please check back regularly or subscribe for departmental procurement notifications.`;
      } else {
        responseText = `Here are the **${openTenders.length} active tender(s)** currently published and open for bidding at **MIT Chhatrapati Sambhajinagar**:\n\n`;
        openTenders.forEach((t, i) => {
          relatedTenders.push(t);
          responseText += `**${i + 1}. [${t.tender_code}] ${t.title}**\n` +
            `   - 🏢 **Dept:** ${t.department}\n` +
            `   - 💰 **Budget:** ₹${t.estimated_budget.toLocaleString('en-IN')} | **EMD:** ₹${t.emd_amount.toLocaleString('en-IN')}\n` +
            `   - ⏳ **Deadline:** ${new Date(t.submission_deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}\n\n`;
        });
        responseText += `👉 *To apply, register as a Contractor, log in with your credentials, and click **"Apply & Bid"**.*`;
      }

    // Case C: Department specific queries (Ref: mit.asia divisions)
    } else if (query.includes('cse') || query.includes('computer') || query.includes('ai') || query.includes('data science') || query.includes('mechanical') || query.includes('robotics') || query.includes('civil') || query.includes('electrical') || query.includes('telecom') || query.includes('polymer') || query.includes('plastic') || query.includes('architecture') || query.includes('medtech') || query.includes('medical') || query.includes('library') || query.includes('estate') || query.includes('hostel') || query.includes('department')) {
      const deptMatches = allTenders.filter(t => 
        ((query.includes('cse') || query.includes('computer')) && t.department.toLowerCase().includes('computer')) ||
        ((query.includes('ai') || query.includes('data science')) && t.department.toLowerCase().includes('artificial')) ||
        ((query.includes('mechanical') || query.includes('robotics')) && t.department.toLowerCase().includes('mechanical')) ||
        (query.includes('civil') && t.department.toLowerCase().includes('civil')) ||
        ((query.includes('electrical') || query.includes('solar')) && t.department.toLowerCase().includes('electrical')) ||
        ((query.includes('polymer') || query.includes('plastic')) && t.department.toLowerCase().includes('plastic')) ||
        (query.includes('architecture') && t.department.toLowerCase().includes('architecture')) ||
        ((query.includes('medtech') || query.includes('medical')) && t.department.toLowerCase().includes('medtech')) ||
        (query.includes('library') && t.department.toLowerCase().includes('library')) ||
        ((query.includes('estate') || query.includes('hostel')) && t.department.toLowerCase().includes('estate'))
      );

      if (deptMatches.length > 0) {
        responseText = `Found **${deptMatches.length} tender(s)** related to your departmental query:\n\n`;
        deptMatches.forEach((t, idx) => {
          relatedTenders.push(t);
          responseText += `**${idx + 1}. [${t.tender_code}] ${t.title}**\n` +
            `   - **Status:** \`${t.status.toUpperCase()}\` | **Budget:** ₹${t.estimated_budget.toLocaleString('en-IN')}\n` +
            `   - **Scope:** ${t.description.substring(0, 150)}...\n\n`;
        });
      } else {
        responseText = `At **Maharashtra Institute of Technology (MIT), Chhatrapati Sambhajinagar** (ref: [mit.asia](https://mit.asia)), our academic and campus divisions include:\n\n` +
          `1. **Computer Science & Engineering (CSE) / AI & Data Science**\n` +
          `2. **Mechanical Engineering & Robotics Research Centre**\n` +
          `3. **Civil Engineering & Campus Infrastructure Division**\n` +
          `4. **Electrical & Electronics (EEE) / Electronics & Telecom (ETC)**\n` +
          `5. **Plastic & Polymer Engineering Department**\n` +
          `6. **School of Architecture & Design (B.Arch / B.Des / M.Arch)**\n` +
          `7. **Department of Management Studies (MBA / MCA / BBA / BCA)**\n` +
          `8. **Marathwada MedTech Innovation Lab & Testing Centre**\n` +
          `9. **Central Knowledge Resource Centre (85,000+ volumes)**\n` +
          `10. **Campus Estate, Hostels & Rooftop Solar Grid Maintenance**\n\n` +
          `You can browse or create tenders for any of these divisions directly in the portal.`;
      }

    // Case D: How to submit a bid / Bidding Procedure
    } else if (query.includes('how to bid') || query.includes('submit bid') || query.includes('apply') || query.includes('process') || query.includes('bidding procedure')) {
      responseText = `### 📝 **Step-by-Step Bidding Procedure for Vendors at MIT College:**\n\n` +
        `1. **Account Registration:**\n` +
        `   - Click **"Sign In / Register"** in the top navigation.\n` +
        `   - Choose **"Contractor / Bidder"** role and fill in your Company Name, License Number, and Experience.\n\n` +
        `2. **Admin Verification:**\n` +
        `   - Your vendor profile is reviewed by the MIT College Registrar/Admin. Once approved, bidding is unlocked.\n\n` +
        `3. **Tender Discovery & BoQ Download:**\n` +
        `   - Navigate to **"Browse Tenders"** to inspect specifications, eligibility criteria, and download BoQs.\n\n` +
        `4. **Sealed Bid Submission:**\n` +
        `   - Open the tender and click **"Apply & Bid"**.\n` +
        `   - Enter your commercial quotation amount (INR).\n` +
        `   - Upload your technical proposal, solvency certificate, GSTIN, and experience certificates.\n` +
        `   - Your quote is encrypted and remains sealed until the official bid opening date.\n\n` +
        `5. **Real-Time Status Tracking:**\n` +
        `   - Track your bid in the **Contractor Workspace** through stages: \`Submitted\` ➔ \`Under Review\` ➔ \`Technical Qualified\` ➔ \`Awarded / L1\`.`;

    // Case E: Document Requirements & Compliance
    } else if (query.includes('document') || query.includes('eligibility') || query.includes('criteria') || query.includes('license') || query.includes('gst') || query.includes('pan')) {
      responseText = `### 📑 **Mandatory Compliance & Document Checklist for MIT Tenders:**\n\n` +
        `- **Statutory Identifiers:** Valid GSTIN Registration Certificate & Permanent Account Number (PAN).\n` +
        `- **Business License:** Maharashtra PWD / CPWD / MSME Udyam Registration Certificate.\n` +
        `- **Financial Solvency:** Audited balance sheets / turnover certificates for the last 3 financial years.\n` +
        `- **Prior Experience:** Completion certificates for similar institutional projects (academic institutes/govt/PSU).\n` +
        `- **OEM Authorization:** Manufacturer Authorization Form (MAF) for hardware/machinery tenders.\n` +
        `- **Earnest Money Deposit (EMD):** Bank Guarantee or online payment proof as specified in the tender notice (MSME/NSIC exemptions apply as per Govt of Maharashtra norms).`;

    // Case F: L1 Ranking & QCBS Evaluation Formula
    } else if (query.includes('l1') || query.includes('lowest') || query.includes('qcbs') || query.includes('evaluation') || query.includes('scoring') || query.includes('formula') || query.includes('how are bids evaluated')) {
      responseText = `### ⚖️ **Evaluation & Ranking Methodology at MIT College:**\n\n` +
        `MIT Chhatrapati Sambhajinagar follows a transparent double-envelope evaluation system:\n\n` +
        `1. **Stage 1 - Technical Evaluation (70% Weightage):**\n` +
        `   - The Purchase Committee scores technical proposals (0–100) based on equipment specifications, past experience, project timeline, and OEM credentials.\n` +
        `   - Minimum qualifying technical score is **70/100**.\n\n` +
        `2. **Stage 2 - Commercial Evaluation & L1 Determination (30% Weightage):**\n` +
        `   - Financial quotes are opened for technically qualified bidders.\n` +
        `   - **L1 (Lowest Bidder)** receives a full financial score of 100.\n` +
        `   - Other bidders receive: \`Financial Score = (L1 Quote / Bidder Quote) × 100\`.\n\n` +
        `3. **Final Combined QCBS Score:**\n` +
        `   $$\\text{Total Score} = (\\text{Technical Score} \\times 0.70) + (\\text{Financial Score} \\times 0.30)$$\n\n` +
        `4. **Contract Award:**\n` +
        `   - The highest combined QCBS score (or compliant L1) is recommended for contract award and receives the official **MIT Letter of Award (LOA)**.`;

    // Case G: General Greetings / Assistance
    } else if (query.includes('hello') || query.includes('hi') || query.includes('help') || query.includes('who are you') || query.includes('mit')) {
      responseText = `Hello! 👋 I am **MIT TenderBot**, the AI Procurement Assistant for **Maharashtra Institute of Technology (MIT), Chhatrapati Sambhajinagar**.\n\n` +
        `I can help you with:\n` +
        `- 🔍 **Active Tenders:** Search live procurement notices and budgets across all MIT departments.\n` +
        `- 📑 **Rules & Documents:** Clarify eligibility, EMD deposits, and document upload requirements.\n` +
        `- 📝 **Bidding Assistance:** Guide you step-by-step on submitting sealed bids.\n` +
        `- ⚖️ **Evaluation Criteria:** Explain L1 commercial ranking and QCBS evaluation formulas.\n\n` +
        `*Try asking: "What tenders are currently open for Computer Science?" or "How is the L1 bidder selected?"*`;

    // Default Fallback
    } else {
      responseText = `I understand you are asking about: *"${message}"*.\n\n` +
        `Here is how I can assist you with procurement at **MIT Chhatrapati Sambhajinagar**:\n\n` +
        `- **View Active Tenders:** Type *"List open tenders"* or check the **Browse Tenders** tab.\n` +
        `- **Check Eligibility:** Ask *"What documents are required for bidding?"*.\n` +
        `- **Evaluation Questions:** Ask *"How does the L1 evaluation work?"*.\n` +
        `- **Assistance for Vendors:** Ask *"How to submit a bid?"*.\n\n` +
        `Feel free to ask any specific question about college tenders or procurement rules!`;
    }

    res.json({
      success: true,
      response: responseText,
      relatedTenders
    });
  } catch (error) {
    console.error('AI Chatbot error:', error);
    res.status(500).json({ success: false, message: 'AI Assistant error: ' + error.message });
  }
});

module.exports = router;
