# Smart Tender Management System Using Web Technologies

A full-stack, enterprise-grade e-procurement and tender management web application designed for Government Departments, Private Authorities, Evaluators, and Contractors.

---

## 🌟 Key Features

1. **Role-Based Access Control (RBAC)**
   - **Admin**: User management, Contractor verification & approval queue, System audit logs, Department statistics.
   - **Tender Authority**: Create and publish procurement tenders, specify budgets, EMD (Earnest Money Deposit), technical criteria, upload BoQ/RFP documents, manage submission deadlines.
   - **Contractor / Bidder**: Company profile registration with license details, tender discovery & filtering, sealed bid submission (commercial quotation + technical proposal + document uploads), real-time application status tracker.
   - **Evaluator**: Document compliance audit, automated **L1 Lowest Bidder** calculation, **QCBS (Quality & Cost Based Selection)** scoring matrix, Winner recommendation, and final Awarding.
   - **Reports & Analytics**: Visual charts (Allocated budget by department, tender status distribution), contractor performance leaderboard, and **official downloadable PDF Reports (Comparative Statements & Letters of Award)**.

2. **Automated Bid Comparison & Ranking Engine**
   - Instant calculation of L1 (Lowest Commercial Quote).
   - Budget variance and percentage deviation calculation.
   - Combined QCBS score computation (70% Technical weightage + 30% Financial ratio weightage).

3. **Confidential & Sealed Bidding**
   - Bids are sealed and tamper-proof until the tender submission deadline is closed.
   - Complete audit logging of all user activities (logins, submissions, approvals, awards).

4. **Official PDF Document Generation**
   - **Letter of Award (LOA)** with official contract terms, price breakdown, and signatory details.
   - **Bid Comparative Statement** report listing ranked contractor quotations, technical scores, and evaluator remarks.

---

## 🛠️ Technology Stack

- **Backend**: Node.js, Express.js REST API
- **Database**: PostgreSQL (relational schema with foreign keys and cascade rules)
- **Security**: JWT Authentication, `bcryptjs` password hashing, Role guards
- **File Handling**: `multer` for secure uploads (BoQs, drawings, licenses)
- **PDF Generation**: `pdfkit` dynamic server-side document streaming
- **Frontend**: HTML5, CSS3 (Modern Responsive UI), Bootstrap 5.3, Bootstrap Icons, FontAwesome, Chart.js

---

## 🚀 Getting Started

### 1. Prerequisites
- Node.js (v18 or higher recommended)
- npm (v9 or higher)

### 2. Installation & Database Setup
```bash
# Navigate to the project directory
cd C:\Users\HP\smart-tender-system5

# Install dependencies
npm install

# Create the PostgreSQL database and configure your local credentials in .env
# Example: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/smart_tender_system

# Seed the database with sample users, tenders, bids, and evaluations
npm run seed
```

### 3. Start the Application
```bash
npm start
```
The server will start at: **`http://localhost:3000`**

### 4. Run Automated Tests
```bash
npm test
```

---

## 👥 Demo Accounts (Quick 1-Click Role Switcher)

The application includes an instant **Demo Role Switcher** in the top navigation header for seamless testing of all 4 roles. You can also sign in manually with these credentials:

| Role | Email | Password | Description |
| :--- | :--- | :--- | :--- |
| **Admin** | `admin@tender.gov` | `admin123` | Full administrative control & contractor approvals |
| **Tender Authority** | `authority@tender.gov` | `authority123` | Creates & publishes tenders, uploads BoQs |
| **Contractor** | `builder@apex.com` | `contractor123` | Apex Construction Ltd (Approved contractor) |
| **Evaluator** | `evaluator@tender.gov` | `evaluator123` | Evaluation committee member for scoring & awarding |

---

## 📊 Database Schema (Tables)

- **`users`**: User ID, Name, Email, Password (hashed), Role (`admin`, `authority`, `contractor`, `evaluator`), Department, Phone, Status.
- **`contractors`**: Contractor ID, User ID, Company Name, License Number, Contact Details, Experience, Registration Status (`pending`, `approved`, `rejected`).
- **`tenders`**: Tender ID, Tender Code, Title, Description, Department, Estimated Budget, EMD, Deadlines, Status (`draft`, `published`, `under_evaluation`, `awarded`, `closed`), Winner Contractor ID.
- **`tender_documents`**: Document ID, Tender ID, File Name, Original Name, File Path, File Type, File Size.
- **`bids`**: Bid ID, Tender ID, Contractor ID, Bid Amount, Technical Proposal, Scores, Status (`submitted`, `qualified`, `disqualified`, `awarded`, `rejected`).
- **`bid_documents`**: Bid Document ID, Bid ID, Document Type, File Path.
- **`evaluations`**: Evaluation ID, Tender ID, Bid ID, Evaluator ID, Technical Score, Financial Score, Recommendation, Comments.
- **`audit_logs`**: Log ID, User ID, Action, Details, IP Address, Timestamp.

---

## 📁 Project Structure

```
smart-tender-system/
├── database/
│   ├── db.js                        # PostgreSQL connection & schema initialization
│   └── seed.js                      # Realistic seed data script
├── middleware/
│   ├── auth.js                      # JWT authentication & RBAC middleware
│   └── upload.js                    # Multer file upload handler
├── routes/
│   ├── authRoutes.js                # Auth, registration, profile & demo switch
│   ├── adminRoutes.js               # User management, contractor verification, logs
│   ├── tenderRoutes.js              # Tender publishing & document management
│   ├── contractorRoutes.js          # Contractor bids submission & status tracker
│   ├── evaluationRoutes.js          # L1 comparison, QCBS scoring & award logic
│   └── reportRoutes.js              # Analytics endpoints & PDF generation
├── public/
│   ├── index.html                   # Responsive frontend interface
│   ├── css/
│   │   └── style.css                # Enterprise design styling & badges
│   ├── js/
│   │   ├── api.js                   # API client & UI formatting helpers
│   │   └── app.js                   # Dashboard logic & dynamic role rendering
│   └── uploads/                     # Uploaded documents directory
├── test.js                          # Automated test suite
├── package.json                     # Project manifest and scripts
└── README.md                        # Documentation
```
