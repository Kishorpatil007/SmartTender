const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const connectionString = (process.env.DATABASE_URL && process.env.DATABASE_URL.trim())
  ? process.env.DATABASE_URL.trim()
  : `postgresql://${process.env.PGUSER || 'postgres'}:${process.env.PGPASSWORD ? encodeURIComponent(process.env.PGPASSWORD) : ''}@${process.env.PGHOST || 'localhost'}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE || 'smarttender'}`;

const pool = new Pool({
  connectionString,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL client error:', err);
});

const db = pool;

const normalizeSql = (sql) => {
  let normalized = sql;

  normalized = normalized.replace(/\bdatetime\(\s*'now'\s*\)/gi, 'NOW()');
  normalized = normalized.replace(/\bdatetime\(\s*"now"\s*\)/gi, 'NOW()');
  normalized = normalized.replace(/\bdatetime\(\s*([^)]+?)\s*\)/gi, (_, expr) => expr.trim());

  normalized = normalized.replace(/\bused\s*=\s*0\b/gi, 'used = FALSE');
  normalized = normalized.replace(/\bused\s*=\s*1\b/gi, 'used = TRUE');
  normalized = normalized.replace(/\bemail_verified\s*=\s*0\b/gi, 'email_verified = FALSE');
  normalized = normalized.replace(/\bemail_verified\s*=\s*1\b/gi, 'email_verified = TRUE');
  normalized = normalized.replace(/\bcompliance_checked\s*=\s*0\b/gi, 'compliance_checked = FALSE');
  normalized = normalized.replace(/\bcompliance_checked\s*=\s*1\b/gi, 'compliance_checked = TRUE');

  // Normalize password_resets boolean column in INSERT: ..., used) VALUES (..., 0)
  normalized = normalized.replace(/(INSERT\s+INTO\s+password_resets\b[^;]+?,\s*)0(\s*\))/gi, '$1FALSE$2');

  // Convert SQLite INSERT OR REPLACE for evaluations to PostgreSQL ON CONFLICT
  normalized = normalized.replace(
    /INSERT\s+OR\s+REPLACE\s+INTO\s+evaluations\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/gi,
    'INSERT INTO evaluations ($1) VALUES ($2) ON CONFLICT (bid_id, evaluator_id) DO UPDATE SET technical_score = EXCLUDED.technical_score, financial_score = EXCLUDED.financial_score, compliance_checked = EXCLUDED.compliance_checked, comments = EXCLUDED.comments, recommendation = EXCLUDED.recommendation, evaluated_at = CURRENT_TIMESTAMP'
  );

  let paramIndex = 0;
  normalized = normalized.replace(/\?/g, () => {
    paramIndex += 1;
    return `$${paramIndex}`;
  });

  return normalized;
};

const dbHelper = {
  db,
  get: async (sql, params = []) => {
    const result = await pool.query(normalizeSql(sql), params);
    return result.rows[0] || null;
  },
  all: async (sql, params = []) => {
    const result = await pool.query(normalizeSql(sql), params);
    return result.rows || [];
  },
  run: async (sql, params = []) => {
    const normalizedSql = normalizeSql(sql);
    const query = /^\s*INSERT\b/i.test(normalizedSql) && !/RETURNING\b/i.test(normalizedSql)
      ? `${normalizedSql} RETURNING id`
      : normalizedSql;

    const result = await pool.query(query, params);
    const lastID = result.rows && result.rows[0] && result.rows[0].id !== undefined
      ? result.rows[0].id
      : null;

    return {
      lastID,
      changes: result.rowCount ?? 0,
      rowCount: result.rowCount ?? 0,
      rows: result.rows || []
    };
  },
  exec: async (sql) => {
    await pool.query(normalizeSql(sql));
    return null;
  },
  transaction: async (callback) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const txHelper = {
        query: (sql, params = []) => client.query(normalizeSql(sql), params),
        get: async (sql, params = []) => {
          const res = await client.query(normalizeSql(sql), params);
          return res.rows[0] || null;
        },
        all: async (sql, params = []) => {
          const res = await client.query(normalizeSql(sql), params);
          return res.rows || [];
        },
        run: async (sql, params = []) => {
          const normalizedSql = normalizeSql(sql);
          const query = /^\s*INSERT\b/i.test(normalizedSql) && !/RETURNING\b/i.test(normalizedSql)
            ? `${normalizedSql} RETURNING id`
            : normalizedSql;
          const res = await client.query(query, params);
          const lastID = res.rows && res.rows[0] && res.rows[0].id !== undefined ? res.rows[0].id : null;
          return { lastID, changes: res.rowCount ?? 0, rowCount: res.rowCount ?? 0, rows: res.rows || [] };
        }
      };
      const result = await callback(txHelper, client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
};

const logFinancialAudit = async ({
  entityType,
  entityId,
  action,
  previousState = null,
  newState = null,
  actorId = null,
  actorRole = null,
  amount = null,
  details = null,
  ipAddress = '127.0.0.1',
  tx = null
}) => {
  const runner = tx || dbHelper;
  try {
    await runner.run(`
      INSERT INTO financial_audit_logs (
        entity_type, entity_id, action, previous_state, new_state,
        actor_id, actor_role, amount, details, ip_address
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      entityType,
      entityId,
      action,
      previousState,
      newState,
      actorId,
      actorRole,
      amount !== null && amount !== undefined ? parseFloat(amount) : null,
      details,
      ipAddress
    ]);
  } catch (err) {
    console.error('Financial audit log write failed:', err);
  }
};

const initSchema = async () => {
  const schemaSQL = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT CHECK(role IN ('admin', 'authority', 'contractor', 'evaluator')) NOT NULL,
      department TEXT,
      phone TEXT,
      employee_id TEXT,
      designation TEXT,
      justification TEXT,
      invitation_token TEXT,
      invitation_expires_at TIMESTAMPTZ,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'pending', 'invited', 'rejected')),
      email_verified BOOLEAN DEFAULT FALSE,
      failed_login_attempts INTEGER DEFAULT 0,
      locked_until TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS contractors (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      company_name TEXT NOT NULL,
      license_number TEXT NOT NULL,
      contact_details TEXT,
      address TEXT,
      experience_years INTEGER DEFAULT 0,
      registration_status TEXT DEFAULT 'pending' CHECK(registration_status IN ('pending', 'approved', 'rejected')),
      gst_number TEXT,
      pan_number TEXT,
      documents_url TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tenders (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      tender_code TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      department TEXT NOT NULL,
      estimated_budget NUMERIC(18,2) NOT NULL,
      emd_amount NUMERIC(18,2) DEFAULT 0,
      submission_deadline TIMESTAMPTZ NOT NULL,
      opening_date TIMESTAMPTZ NOT NULL,
      eligibility_criteria TEXT,
      status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'under_evaluation', 'awarded', 'closed', 'cancelled')),
      created_by INTEGER NOT NULL REFERENCES users(id),
      awarded_to_contractor_id INTEGER REFERENCES contractors(id),
      award_date TIMESTAMPTZ,
      award_notes TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tender_documents (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_type TEXT,
      file_size INTEGER,
      uploaded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bids (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
      contractor_id INTEGER NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
      bid_amount NUMERIC(18,2) NOT NULL,
      technical_proposal TEXT,
      remarks TEXT,
      technical_score NUMERIC(10,2) DEFAULT 0,
      financial_score NUMERIC(10,2) DEFAULT 0,
      total_score NUMERIC(10,2) DEFAULT 0,
      status TEXT DEFAULT 'submitted' CHECK(status IN ('submitted', 'under_review', 'qualified', 'disqualified', 'awarded', 'rejected')),
      submission_date TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tender_id, contractor_id)
    );

    CREATE TABLE IF NOT EXISTS bid_documents (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      bid_id INTEGER NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
      document_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER,
      uploaded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS evaluations (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
      bid_id INTEGER NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
      evaluator_id INTEGER NOT NULL REFERENCES users(id),
      technical_score NUMERIC(10,2) NOT NULL,
      financial_score NUMERIC(10,2) NOT NULL,
      compliance_checked BOOLEAN DEFAULT TRUE,
      comments TEXT,
      recommendation TEXT CHECK(recommendation IN ('recommended', 'acceptable', 'not_recommended')),
      evaluated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(bid_id, evaluator_id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      details TEXT,
      ip_address TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      email TEXT NOT NULL,
      otp TEXT NOT NULL,
      otp_hash TEXT,
      type TEXT DEFAULT 'PASSWORD_RESET',
      token TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      receipt_no TEXT UNIQUE NOT NULL,
      contractor_id INTEGER NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
      payment_type TEXT NOT NULL CHECK(payment_type IN ('TENDER_FEE', 'EMD')),
      amount BIGINT NOT NULL,
      amount_rupees NUMERIC(18,2) NOT NULL,
      currency TEXT DEFAULT 'INR',
      payment_provider TEXT DEFAULT 'razorpay',
      payment_mode TEXT DEFAULT 'test' CHECK(payment_mode IN ('test', 'live')),
      provider_order_id TEXT,
      provider_payment_id TEXT,
      provider_signature TEXT,
      payment_status TEXT NOT NULL DEFAULT 'CREATED' CHECK(payment_status IN ('CREATED', 'PENDING', 'PAID', 'FAILED', 'REFUND_PENDING', 'REFUNDED')),
      signature_verified BOOLEAN DEFAULT FALSE,
      failure_reason TEXT,
      refund_reference TEXT,
      refund_status TEXT,
      refund_reason TEXT,
      refunded_at TIMESTAMPTZ,
      paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS payment_webhook_events (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      event_id TEXT UNIQUE NOT NULL,
      event_type TEXT NOT NULL,
      provider TEXT DEFAULT 'razorpay',
      payload TEXT,
      processed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_unique_paid_obligation 
    ON payments (contractor_id, tender_id, payment_type) 
    WHERE payment_status = 'PAID';

    CREATE INDEX IF NOT EXISTS idx_payments_contractor ON payments (contractor_id);
    CREATE INDEX IF NOT EXISTS idx_payments_tender ON payments (tender_id);
    CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments (provider_order_id);
    CREATE INDEX IF NOT EXISTS idx_payments_payment_id ON payments (provider_payment_id);
    CREATE INDEX IF NOT EXISTS idx_payments_status ON payments (payment_status);

    -- Module 1: Contractor Payment Management (Institution -> Selected Contractor)
    CREATE TABLE IF NOT EXISTS contractor_payments (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE RESTRICT,
      contractor_id INTEGER NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
      work_order_ref TEXT NOT NULL,
      contract_amount NUMERIC(18,2) NOT NULL CHECK(contract_amount >= 0),
      deductions_amount NUMERIC(18,2) DEFAULT 0 CHECK(deductions_amount >= 0),
      tax_amount NUMERIC(18,2) DEFAULT 0 CHECK(tax_amount >= 0),
      retention_amount NUMERIC(18,2) DEFAULT 0 CHECK(retention_amount >= 0),
      approved_payable_amount NUMERIC(18,2) NOT NULL CHECK(approved_payable_amount >= 0),
      total_paid_amount NUMERIC(18,2) DEFAULT 0 CHECK(total_paid_amount >= 0),
      remaining_payable_amount NUMERIC(18,2) NOT NULL CHECK(remaining_payable_amount >= 0),
      work_status TEXT NOT NULL DEFAULT 'contract_awarded' 
        CHECK(work_status IN ('contract_awarded', 'work_in_progress', 'completion_submitted', 'inspection_pending', 'inspection_approved', 'inspection_rejected', 'disputed')),
      claim_status TEXT NOT NULL DEFAULT 'draft' 
        CHECK(claim_status IN ('draft', 'claim_submitted', 'approval_pending', 'approved', 'rejected', 'partially_paid', 'fully_paid', 'cancelled')),
      invoice_ref TEXT,
      invoice_date TIMESTAMPTZ,
      claimed_amount NUMERIC(18,2) DEFAULT 0 CHECK(claimed_amount >= 0),
      work_completion_date TIMESTAMPTZ,
      inspection_date TIMESTAMPTZ,
      inspection_notes TEXT,
      inspected_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      approved_at TIMESTAMPTZ,
      rejection_reason TEXT,
      completion_evidence_url TEXT,
      invoice_document_url TEXT,
      remarks TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(tender_id, contractor_id)
    );

    CREATE TABLE IF NOT EXISTS contractor_payment_transactions (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      contractor_payment_id INTEGER NOT NULL REFERENCES contractor_payments(id) ON DELETE CASCADE,
      tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE RESTRICT,
      contractor_id INTEGER NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
      transaction_ref TEXT UNIQUE NOT NULL,
      payment_method TEXT NOT NULL CHECK(payment_method IN ('bank_transfer', 'neft', 'rtgs', 'imps', 'cheque', 'razorpay_payout', 'other')),
      amount NUMERIC(18,2) NOT NULL CHECK(amount > 0),
      payment_date TIMESTAMPTZ NOT NULL,
      execution_type TEXT NOT NULL DEFAULT 'MANUAL_RECORD' CHECK(execution_type IN ('MANUAL_RECORD', 'AUTOMATED_PAYOUT')),
      payment_status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK(payment_status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REVERSED')),
      bank_name TEXT,
      bank_account_last4 TEXT,
      processed_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      supporting_doc_url TEXT,
      remarks TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    -- Module 2: EMD Refund Management (Institution -> Eligible Contractor)
    CREATE TABLE IF NOT EXISTS emd_refund_records (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      original_payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
      tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE RESTRICT,
      contractor_id INTEGER NOT NULL REFERENCES contractors(id) ON DELETE RESTRICT,
      original_emd_amount NUMERIC(18,2) NOT NULL CHECK(original_emd_amount >= 0),
      refund_eligible_amount NUMERIC(18,2) NOT NULL CHECK(refund_eligible_amount >= 0),
      refund_amount NUMERIC(18,2) DEFAULT 0 CHECK(refund_amount >= 0),
      eligibility_type TEXT NOT NULL 
        CHECK(eligibility_type IN ('UNSUCCESSFUL_BIDDER', 'TENDER_CANCELLED', 'TENDER_WITHDRAWN', 'SUCCESSFUL_BIDDER_RELEASE', 'FORFEITURE', 'OTHER')),
      eligibility_notes TEXT,
      eligibility_date TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      refund_status TEXT NOT NULL DEFAULT 'ELIGIBLE' 
        CHECK(refund_status IN ('ELIGIBLE', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'PROCESSING', 'COMPLETED', 'FAILED', 'FORFEITED')),
      execution_type TEXT DEFAULT 'BANK_TRANSFER' CHECK(execution_type IN ('RAZORPAY_GATEWAY', 'BANK_TRANSFER')),
      provider_refund_id TEXT,
      transaction_ref TEXT,
      payment_method TEXT,
      requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      approved_at TIMESTAMPTZ,
      processed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      processed_at TIMESTAMPTZ,
      rejection_reason TEXT,
      forfeiture_reason TEXT,
      failure_reason TEXT,
      remarks TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(original_payment_id)
    );

    -- Module 3: Financial Append-Only Audit History
    CREATE TABLE IF NOT EXISTS financial_audit_logs (
      id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('CONTRACTOR_PAYMENT', 'CONTRACTOR_PAYMENT_TXN', 'EMD_REFUND')),
      entity_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      previous_state TEXT,
      new_state TEXT,
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      actor_role TEXT,
      amount NUMERIC(18,2),
      details TEXT,
      ip_address TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_contractor_payments_tender ON contractor_payments(tender_id);
    CREATE INDEX IF NOT EXISTS idx_contractor_payments_contractor ON contractor_payments(contractor_id);
    CREATE INDEX IF NOT EXISTS idx_contractor_payments_claim_status ON contractor_payments(claim_status);
    CREATE INDEX IF NOT EXISTS idx_contractor_payments_work_status ON contractor_payments(work_status);

    CREATE INDEX IF NOT EXISTS idx_contractor_pmt_txns_claim ON contractor_payment_transactions(contractor_payment_id);
    CREATE INDEX IF NOT EXISTS idx_contractor_pmt_txns_tender ON contractor_payment_transactions(tender_id);
    CREATE INDEX IF NOT EXISTS idx_contractor_pmt_txns_contractor ON contractor_payment_transactions(contractor_id);

    CREATE INDEX IF NOT EXISTS idx_emd_refunds_tender ON emd_refund_records(tender_id);
    CREATE INDEX IF NOT EXISTS idx_emd_refunds_contractor ON emd_refund_records(contractor_id);
    CREATE INDEX IF NOT EXISTS idx_emd_refunds_payment ON emd_refund_records(original_payment_id);
    CREATE INDEX IF NOT EXISTS idx_emd_refunds_status ON emd_refund_records(refund_status);

    CREATE INDEX IF NOT EXISTS idx_fin_audit_entity ON financial_audit_logs(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_fin_audit_actor ON financial_audit_logs(actor_id);
  `;

  await dbHelper.exec(schemaSQL);

  const safeAddColumn = async (table, columnDef) => {
    try {
      await dbHelper.run(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS ${columnDef}`);
    } catch (error) {
      // Ignore if schema already includes the required column or the syntax is incompatible.
    }
  };

  await safeAddColumn('users', 'email_verified BOOLEAN DEFAULT FALSE');
  await safeAddColumn('users', 'failed_login_attempts INTEGER DEFAULT 0');
  await safeAddColumn('users', 'locked_until TIMESTAMPTZ');
  await safeAddColumn('users', 'employee_id TEXT');
  await safeAddColumn('users', 'designation TEXT');
  await safeAddColumn('users', 'justification TEXT');
  await safeAddColumn('users', 'invitation_token TEXT');
  await safeAddColumn('users', 'invitation_expires_at TIMESTAMPTZ');
  await safeAddColumn('contractors', 'gst_number TEXT');
  await safeAddColumn('contractors', 'pan_number TEXT');
  await safeAddColumn('password_resets', 'otp_hash TEXT');
  await safeAddColumn('password_resets', "type TEXT DEFAULT 'PASSWORD_RESET'");
  await safeAddColumn('tenders', 'tender_fee NUMERIC(18,2) DEFAULT 1000');

  console.log('Database tables initialized successfully for MIT Chhatrapati Sambhajinagar.');
      // Bootstrap first administrator if none exists
    const adminCheck = await dbHelper.get(
      "SELECT COUNT(*) AS count FROM users WHERE role = 'admin'"
    );

    if (Number(adminCheck.count) === 0) {
      const adminEmail = process.env.INITIAL_ADMIN_EMAIL;
      const adminPassword = process.env.INITIAL_ADMIN_PASSWORD;

      if (!adminEmail || !adminPassword) {
        console.warn(
          '[ADMIN BOOTSTRAP] No admin exists and INITIAL_ADMIN_EMAIL / INITIAL_ADMIN_PASSWORD are not configured.'
        );
      } else {
        const hashedPassword = bcrypt.hashSync(adminPassword, 10);

        await dbHelper.run(
          `INSERT INTO users
           (name, email, password, role, department, status,
            email_verified, failed_login_attempts, locked_until)
           VALUES (?, ?, ?, 'admin', ?, 'active', TRUE, 0, NULL)`,
          [
            'System Administrator',
            adminEmail.toLowerCase().trim(),
            hashedPassword,
            'Central Administration'
          ]
        );

        console.log(
          `[ADMIN BOOTSTRAP] Initial administrator created: ${adminEmail}`
        );
      }
    }
};

module.exports = {
  db,
  dbHelper,
  initSchema,
  logFinancialAudit
};
