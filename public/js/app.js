/**
 * Main Single Page Application (SPA) Controller
 * Maharashtra Institute of Technology (MIT), Chhatrapati Sambhajinagar
 */

let currentUser = null;
let currentView = 'landing';
let chartInstances = {};
let adminAccountExists = false;

// ----------------------------------------------------
// INITIALIZATION & ROUTING
// ----------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  await initSession();
  await refreshAdminStatus();
  setupEventListeners();

  // Check if URL hash or search params have an invitation link
  const hash = window.location.hash;
  if (hash.includes('set-password')) {
    const queryPart = hash.includes('?') ? hash.split('?')[1] : window.location.search.replace('?', '');
    const urlParams = new URLSearchParams(queryPart);
    const token = urlParams.get('token');
    const email = urlParams.get('email');
    setTimeout(() => openSetPasswordModal(token, email), 400);
  }

  navigateTo(getInitialRoute());
});

function getInitialRoute() {
  const hash = window.location.hash.replace('#', '').split('?')[0];
  return hash || 'landing';
}

async function initSession() {
  const token = API.getToken();
  if (token) {
    try {
      const res = await API.auth.getProfile();
      if (res.success && res.user) {
        currentUser = res.user;
        API.setUser(currentUser);
        updateNavState(true);
      } else {
        logout();
      }
    } catch (err) {
      console.warn('Session verification failed:', err);
      logout();
    }
  } else {
    updateNavState(false);
  }
}

function updateNavState(isLoggedIn) {
  const guestActions = document.getElementById('nav-guest-actions');
  const userActions = document.getElementById('nav-user-actions');
  const roleBadge = document.getElementById('active-role-badge');
  const userNameEl = document.getElementById('current-user-name');

  // Sidebar Role Sections
  const adminNav = document.getElementById('nav-section-admin');
  const authorityNav = document.getElementById('nav-section-authority');
  const contractorNav = document.getElementById('nav-section-contractor');
  const evaluatorNav = document.getElementById('nav-section-evaluator');

  // Hide all role sections initially
  if (adminNav) adminNav.classList.add('d-none');
  if (authorityNav) authorityNav.classList.add('d-none');
  if (contractorNav) contractorNav.classList.add('d-none');
  if (evaluatorNav) evaluatorNav.classList.add('d-none');

  if (isLoggedIn && currentUser) {
    if (guestActions) guestActions.classList.add('d-none');
    if (userActions) userActions.classList.remove('d-none');

    if (roleBadge) {
      roleBadge.textContent = currentUser.role.toUpperCase();
      roleBadge.className = `badge ${currentUser.role === 'admin' ? 'bg-danger' : currentUser.role === 'authority' ? 'bg-warning text-dark' : currentUser.role === 'contractor' ? 'bg-success' : 'bg-info text-dark'}`;
    }
    if (userNameEl) userNameEl.textContent = currentUser.name;

    // Show appropriate role navigation
    if (currentUser.role === 'admin' && adminNav) adminNav.classList.remove('d-none');
    if (currentUser.role === 'authority' && authorityNav) authorityNav.classList.remove('d-none');
    if (currentUser.role === 'contractor' && contractorNav) contractorNav.classList.remove('d-none');
    if (currentUser.role === 'evaluator' && evaluatorNav) evaluatorNav.classList.remove('d-none');
  } else {
    if (guestActions) guestActions.classList.remove('d-none');
    if (userActions) userActions.classList.add('d-none');
  }
}

// ----------------------------------------------------
// MOBILE NAVIGATION DRAWER CONTROLLER
// ----------------------------------------------------
function openMobileSidebar() {
  const sidebar = document.getElementById('appSidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.add('show');
  if (backdrop) backdrop.classList.add('show');
  document.body.classList.add('sidebar-open');
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('appSidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.remove('show');
  if (backdrop) backdrop.classList.remove('show');
  document.body.classList.remove('sidebar-open');
}

function toggleMobileSidebar() {
  const sidebar = document.getElementById('appSidebar');
  if (sidebar && sidebar.classList.contains('show')) {
    closeMobileSidebar();
  } else {
    openMobileSidebar();
  }
}

window.openMobileSidebar = openMobileSidebar;
window.closeMobileSidebar = closeMobileSidebar;
window.toggleMobileSidebar = toggleMobileSidebar;

function navigateTo(viewName) {
  // Role Access Guard
  const protectedViews = {
    admin: ['admin'],
    authority: ['authority', 'admin'],
    contractor: ['contractor', 'admin'],
    evaluator: ['evaluator', 'authority', 'admin']
  };

  if (protectedViews[viewName]) {
    if (!currentUser) {
      UI.showToast('Please sign in with your college credentials to access this workspace.', 'info');
      const authModal = new bootstrap.Modal(document.getElementById('authModal'));
      authModal.show();
      return;
    }
    if (!protectedViews[viewName].includes(currentUser.role)) {
      UI.showToast(`Access Denied: Requires ${viewName.toUpperCase()} role privilege.`, 'error');
      return;
    }
  }

  currentView = viewName;
  window.location.hash = viewName;

  // Hide all views
  document.querySelectorAll('.view-container').forEach(el => el.classList.add('d-none'));

  // Show target view
  const targetEl = document.getElementById(`view-${viewName}`);
  if (targetEl) {
    targetEl.classList.remove('d-none');
  } else {
    document.getElementById('view-landing').classList.remove('d-none');
  }

  // Update active navigation link
  document.querySelectorAll('.sidebar-nav .nav-link').forEach(link => {
    if (link.getAttribute('data-view') === viewName) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  // Load View Specific Data
  switch (viewName) {
    case 'landing':
      loadLandingView();
      break;
    case 'tenders':
      loadTendersView();
      break;
    case 'admin':
      loadAdminView();
      break;
    case 'authority':
      loadAuthorityView();
      break;
    case 'contractor':
      loadContractorView();
      break;
    case 'evaluator':
      loadEvaluatorView();
      break;
    case 'reports':
      loadReportsView();
      break;
  }

  // Close mobile sidebar if open on smaller screens
  if (window.innerWidth < 992) {
    closeMobileSidebar();
  }

  window.scrollTo(0, 0);
}

// ----------------------------------------------------
// 1. LANDING VIEW
// ----------------------------------------------------
async function loadLandingView() {
  try {
    const summaryRes = await API.reports.getSummary();
    const stats = summaryRes.data.overview || {};

    const elTotal = document.getElementById('landing-stat-tenders');
    const elOpen = document.getElementById('landing-stat-open');
    const elContractors = document.getElementById('landing-stat-contractors');
    const elBudget = document.getElementById('landing-stat-budget');

    if (elTotal) elTotal.textContent = stats.total_tenders || '0';
    if (elOpen) elOpen.textContent = stats.open_tenders || '0';
    if (elContractors) elContractors.textContent = stats.approved_contractors || '0';
    if (elBudget) elBudget.textContent = UI.formatCurrency(stats.total_tender_budget || 0);

    // Load featured published tenders
    const tendersRes = await API.tenders.getAll('?status=published');
    const container = document.getElementById('landing-featured-tenders');
    if (!container) return;

    if (!tendersRes.tenders || tendersRes.tenders.length === 0) {
      container.innerHTML = '<div class="col-12 text-center text-muted py-4"><i class="bi bi-folder-x display-6 d-block mb-2 text-secondary"></i>No active college tenders published at the moment.</div>';
      return;
    }

    container.innerHTML = tendersRes.tenders.slice(0, 3).map(t => `
      <div class="col-md-4 mb-4">
        <div class="tender-card p-4">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <span class="tender-code">${t.tender_code}</span>
            ${UI.getStatusBadge(t.status)}
          </div>
          <h5 class="fw-bold mb-2 text-truncate" title="${t.title}">${t.title}</h5>
          <p class="text-muted small mb-3 text-truncate-2" style="min-height: 40px;">${t.description}</p>
          <div class="border-top pt-3 mt-auto">
            <div class="d-flex justify-content-between small text-muted mb-1">
              <span>Department:</span>
              <strong class="text-dark">${t.department}</strong>
            </div>
            <div class="d-flex justify-content-between small text-muted mb-1">
              <span>Estimated Budget:</span>
              <strong class="text-success">${UI.formatCurrency(t.estimated_budget)}</strong>
            </div>
            <div class="d-flex justify-content-between small text-muted mb-3">
              <span>Submission Deadline:</span>
              <strong class="text-danger">${UI.formatDate(t.submission_deadline)}</strong>
            </div>
            <button class="btn btn-sm btn-outline-primary w-100" onclick="viewTenderDetails(${t.id})">
              <i class="bi bi-eye me-1"></i> View Tender Details
            </button>
          </div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Error loading landing view:', err);
  }
}

// ----------------------------------------------------
// 2. TENDERS DIRECTORY VIEW
// ----------------------------------------------------
async function loadTendersView() {
  const searchInput = document.getElementById('tender-search-input');
  const deptSelect = document.getElementById('tender-dept-filter');
  const statusSelect = document.getElementById('tender-status-filter');

  const search = searchInput ? searchInput.value.trim() : '';
  const dept = deptSelect ? deptSelect.value : '';
  const status = statusSelect ? statusSelect.value : '';

  let query = '?';
  if (search) query += `search=${encodeURIComponent(search)}&`;
  if (dept) query += `department=${encodeURIComponent(dept)}&`;
  if (status) query += `status=${encodeURIComponent(status)}&`;

  try {
    const res = await API.tenders.getAll(query);
    const container = document.getElementById('tenders-grid-container');
    const countEl = document.getElementById('tenders-count-badge');

    if (countEl) countEl.textContent = `${res.tenders.length} Tenders`;
    if (!container) return;

    if (res.tenders.length === 0) {
      container.innerHTML = `
        <div class="col-12 text-center py-5 text-muted bg-white rounded-4 border">
          <i class="bi bi-search display-5 d-block mb-3 text-secondary"></i>
          <h5>No tenders found</h5>
          <p class="small">Try adjusting your search query or college department filter.</p>
        </div>
      `;
      return;
    }

    // If logged in as contractor, load paid payment map to dynamically render "Apply Sealed Bid" vs "Pay Fees to Bid"
    let paidTendersMap = {};
    if (currentUser && currentUser.role === 'contractor') {
      try {
        const payRes = await API.payments.getHistory();
        if (payRes && payRes.payments) {
          payRes.payments.forEach(p => {
            if (p.payment_status === 'PAID') {
              if (!paidTendersMap[p.tender_id]) paidTendersMap[p.tender_id] = {};
              paidTendersMap[p.tender_id][p.payment_type] = true;
            }
          });
        }
      } catch (payErr) {
        console.warn('Could not load payment status for tenders grid:', payErr);
      }
    }

    container.innerHTML = res.tenders.map(t => {
      const emdNeeded = t.emd_amount && parseFloat(t.emd_amount) > 0;
      const feePaid = paidTendersMap[t.id] && paidTendersMap[t.id]['TENDER_FEE'];
      const emdPaid = !emdNeeded || (paidTendersMap[t.id] && paidTendersMap[t.id]['EMD']);
      const isEligibleToBid = feePaid && emdPaid;

      let actionBtn = '';
      if (t.status === 'published') {
        if (currentUser && currentUser.role === 'contractor') {
          if (isEligibleToBid) {
            actionBtn = `
              <button class="btn btn-sm btn-success flex-fill" onclick="openBidModalForTender(${t.id}, '${t.tender_code}', '${t.title.replace(/'/g, "\\'")}')">
                <i class="bi bi-send-check me-1"></i> Apply Sealed Bid
              </button>
            `;
          } else {
            actionBtn = `
              <button class="btn btn-sm btn-outline-warning text-dark flex-fill" onclick="viewTenderDetails(${t.id})">
                <i class="bi bi-wallet2 me-1"></i> Pay Fees to Bid
              </button>
            `;
          }
        } else {
          actionBtn = `
            <button class="btn btn-sm btn-outline-primary flex-fill" onclick="viewTenderDetails(${t.id})">
              <i class="bi bi-eye me-1"></i> View Details & Pay
            </button>
          `;
        }
      }

      return `
      <div class="col-lg-4 col-md-6 mb-4">
        <div class="tender-card p-4">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <span class="tender-code">${t.tender_code}</span>
            ${UI.getStatusBadge(t.status)}
          </div>
          <h5 class="fw-bold mb-2" title="${t.title}" style="height: 48px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">${t.title}</h5>
          <p class="text-muted small mb-3" style="height: 40px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">${t.description}</p>
          
          <div class="bg-light p-2.5 rounded-3 mb-3 small">
            <div class="d-flex justify-content-between mb-1">
              <span class="text-muted">College Dept:</span>
              <strong class="text-dark text-truncate ms-2" style="max-width: 60%;">${t.department}</strong>
            </div>
            <div class="d-flex justify-content-between mb-1">
              <span class="text-muted">Budget:</span>
              <strong class="text-success">${UI.formatCurrency(t.estimated_budget)}</strong>
            </div>
            <div class="d-flex justify-content-between mb-1">
              <span class="text-muted">EMD Deposit:</span>
              <strong class="text-dark">${UI.formatCurrency(t.emd_amount)}</strong>
            </div>
            <div class="d-flex justify-content-between">
              <span class="text-muted">Deadline:</span>
              <strong class="text-danger">${UI.formatDateTime(t.submission_deadline)}</strong>
            </div>
          </div>

          <div class="mt-auto d-flex gap-2">
            <button class="btn btn-sm btn-outline-primary flex-fill" onclick="viewTenderDetails(${t.id})">
              <i class="bi bi-info-circle me-1"></i> Specifications
            </button>
            ${actionBtn}
          </div>
        </div>
      </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading tenders view:', err);
  }
}

// View Tender Details Modal
window.viewTenderDetails = async function(tenderId) {
  try {
    const res = await API.tenders.getById(tenderId);
    const t = res.tender;

    document.getElementById('modal-tender-code').textContent = t.tender_code;
    document.getElementById('modal-tender-title').textContent = t.title;
    document.getElementById('modal-tender-status').innerHTML = UI.getStatusBadge(t.status);
    document.getElementById('modal-tender-dept').textContent = t.department;
    document.getElementById('modal-tender-budget').textContent = UI.formatCurrency(t.estimated_budget);
    document.getElementById('modal-tender-emd').textContent = UI.formatCurrency(t.emd_amount);
    document.getElementById('modal-tender-deadline').textContent = UI.formatDateTime(t.submission_deadline);
    document.getElementById('modal-tender-opening').textContent = UI.formatDateTime(t.opening_date);
    document.getElementById('modal-tender-desc').textContent = t.description;
    document.getElementById('modal-tender-eligibility').textContent = t.eligibility_criteria || 'Statutory GSTIN, PAN, and OEM authorization required.';
    document.getElementById('modal-tender-creator').textContent = `${t.created_by_name || 'Purchase Office'} (${t.created_by_email || 'purchase@mit.asia'})`;

    window.currentViewingTender = t;

    let payStatus = null;
    if (currentUser && currentUser.role === 'contractor' && t.status === 'published') {
      try {
        payStatus = await API.payments.getTenderStatus(t.id);
      } catch (payErr) {
        console.warn('Could not load tender payment status:', payErr);
      }
    }

    // Payment Section Visibility & Data for Contractor
    const paymentSec = document.getElementById('modal-payment-section');
    if (paymentSec) {
      if (currentUser && currentUser.role === 'contractor' && t.status === 'published' && payStatus) {
        paymentSec.classList.remove('d-none');
        try {
          const payConfig = await API.payments.getConfig();

          const modeBadge = document.getElementById('modal-payment-mode-badge');
          if (modeBadge && payConfig && payConfig.config) {
            const isLive = payConfig.config.mode === 'live';
            modeBadge.className = isLive ? 'badge-live-mode' : 'badge-test-mode';
            modeBadge.textContent = isLive ? 'LIVE GATEWAY' : 'TEST MODE';
          }

          // Tender Fee
          const feeAmountEl = document.getElementById('modal-tender-fee-amount');
          const feeBadgeEl = document.getElementById('modal-tender-fee-badge');
          const payFeeBtn = document.getElementById('btn-pay-tender-fee');
          const viewFeeBtn = document.getElementById('btn-view-fee-receipt');

          if (feeAmountEl) feeAmountEl.textContent = UI.formatCurrency(payStatus.tenderFee.amountRupees);
          if (payStatus.tenderFee.paid) {
            if (feeBadgeEl) {
              feeBadgeEl.className = 'badge bg-success';
              feeBadgeEl.innerHTML = '<i class="bi bi-check-circle me-1"></i>PAID';
            }
            if (payFeeBtn) payFeeBtn.classList.add('d-none');
            if (viewFeeBtn) viewFeeBtn.classList.remove('d-none');
          } else {
            if (feeBadgeEl) {
              feeBadgeEl.className = 'badge bg-warning text-dark';
              feeBadgeEl.textContent = 'Unpaid';
            }
            if (payFeeBtn) {
              payFeeBtn.classList.remove('d-none');
              payFeeBtn.disabled = false;
              payFeeBtn.innerHTML = '<i class="bi bi-wallet2 me-1"></i> Pay Fee';
            }
            if (viewFeeBtn) viewFeeBtn.classList.add('d-none');
          }

          // EMD Deposit
          const emdAmountEl = document.getElementById('modal-tender-emd-amount');
          const emdBadgeEl = document.getElementById('modal-tender-emd-badge');
          const payEmdBtn = document.getElementById('btn-pay-emd');
          const viewEmdBtn = document.getElementById('btn-view-emd-receipt');

          if (emdAmountEl) emdAmountEl.textContent = UI.formatCurrency(payStatus.emd.amountRupees);
          if (!payStatus.emd.required) {
            if (emdBadgeEl) {
              emdBadgeEl.className = 'badge bg-light text-dark border';
              emdBadgeEl.textContent = 'Exempt (₹0)';
            }
            if (payEmdBtn) {
              payEmdBtn.classList.remove('d-none');
              payEmdBtn.disabled = true;
              payEmdBtn.textContent = 'No EMD Required';
            }
            if (viewEmdBtn) viewEmdBtn.classList.add('d-none');
          } else if (payStatus.emd.paid) {
            if (emdBadgeEl) {
              emdBadgeEl.className = 'badge bg-success';
              emdBadgeEl.innerHTML = '<i class="bi bi-check-circle me-1"></i>PAID';
            }
            if (payEmdBtn) payEmdBtn.classList.add('d-none');
            if (viewEmdBtn) viewEmdBtn.classList.remove('d-none');
          } else {
            if (emdBadgeEl) {
              emdBadgeEl.className = 'badge bg-warning text-dark';
              emdBadgeEl.textContent = 'Unpaid';
            }
            if (payEmdBtn) {
              payEmdBtn.classList.remove('d-none');
              payEmdBtn.disabled = false;
              payEmdBtn.innerHTML = '<i class="bi bi-shield-check me-1"></i> Pay EMD';
            }
            if (viewEmdBtn) viewEmdBtn.classList.add('d-none');
          }

          const complianceAlert = document.getElementById('modal-payment-compliance-alert');
          if (complianceAlert) {
            complianceAlert.classList.remove('d-none');
            const compMsg = document.getElementById('modal-payment-compliance-msg');
            if (compMsg) {
              if (payStatus.allPaid) {
                complianceAlert.className = 'alert alert-success d-flex align-items-center mb-3 border-0 bg-success bg-opacity-10 text-success rounded-3';
                compMsg.innerHTML = '<strong class="text-success"><i class="bi bi-check-circle-fill me-1"></i> Payment Verified & Confirmed!</strong> All fee obligations are fulfilled. You are authorized to submit your sealed bid quotation. Click <strong>"Apply Sealed Bid"</strong> below.';
              } else {
                complianceAlert.className = 'alert alert-warning d-flex align-items-center mb-3 border-0 bg-warning bg-opacity-10 text-dark rounded-3';
                compMsg.innerHTML = '<strong class="text-danger"><i class="bi bi-lock-fill me-1"></i> Bidding Locked — Fee Payment Required:</strong> Both Tender Application Fee and EMD (if required) must be paid and verified below before you can apply or submit a sealed bid.';
              }
            }
          }
        } catch (payErr) {
          console.warn('Could not load tender payment status:', payErr);
        }
      } else {
        paymentSec.classList.add('d-none');
      }
    }

    // Attached Documents List
    const docsContainer = document.getElementById('modal-tender-docs-list');
    if (docsContainer) {
      if (t.documents && t.documents.length > 0) {
        docsContainer.innerHTML = t.documents.map(d => `
          <div class="d-flex justify-content-between align-items-center p-2 border rounded mb-2 bg-light">
            <div class="d-flex align-items-center gap-2">
              <i class="bi bi-file-earmark-pdf-fill text-danger fs-5"></i>
              <div>
                <div class="fw-semibold small">${d.original_name}</div>
                <div class="text-muted" style="font-size: 0.72rem;">${(d.file_size / (1024 * 1024)).toFixed(2)} MB • Uploaded: ${UI.formatDate(d.uploaded_at)}</div>
              </div>
            </div>
            <a href="${d.file_path}" target="_blank" class="btn btn-sm btn-outline-secondary">
              <i class="bi bi-download me-1"></i> Download
            </a>
          </div>
        `).join('');
      } else {
        docsContainer.innerHTML = '<div class="text-muted small">No specification files attached.</div>';
      }
    }

    // Bid action button: Enabled ONLY after verified payment
    const bidBtn = document.getElementById('modal-tender-bid-btn');
    if (bidBtn) {
      if (t.status === 'published') {
        bidBtn.classList.remove('d-none');
        if (currentUser && currentUser.role === 'contractor') {
          if (payStatus && payStatus.allPaid) {
            bidBtn.disabled = false;
            bidBtn.className = 'btn btn-success';
            bidBtn.innerHTML = '<i class="bi bi-send-check me-1"></i> Apply Sealed Bid';
            bidBtn.onclick = () => {
              const detailModal = bootstrap.Modal.getInstance(document.getElementById('tenderDetailModal'));
              if (detailModal) detailModal.hide();
              openBidModalForTender(t.id, t.tender_code, t.title);
            };
          } else {
            bidBtn.disabled = true;
            bidBtn.className = 'btn btn-secondary';
            bidBtn.innerHTML = '<i class="bi bi-lock-fill me-1"></i> Pay Fees Above to Unlock Bidding';
            bidBtn.onclick = null;
          }
        } else if (!currentUser) {
          bidBtn.disabled = false;
          bidBtn.className = 'btn btn-primary';
          bidBtn.innerHTML = '<i class="bi bi-box-arrow-in-right me-1"></i> Sign In as Contractor to Bid';
          bidBtn.onclick = () => {
            const detailModal = bootstrap.Modal.getInstance(document.getElementById('tenderDetailModal'));
            if (detailModal) detailModal.hide();
            openBidModalForTender(t.id, t.tender_code, t.title);
          };
        } else {
          bidBtn.classList.add('d-none');
        }
      } else {
        bidBtn.classList.add('d-none');
      }
    }

    const modal = new bootstrap.Modal(document.getElementById('tenderDetailModal'));
    modal.show();
  } catch (err) {
    UI.showToast('Could not load tender details: ' + err.message, 'error');
  }
};

// ----------------------------------------------------
// 3. TENDER AUTHORITY WORKSPACE
// ----------------------------------------------------
async function loadAuthorityView() {
  try {
    const res = await API.tenders.getAll();
    const tableBody = document.getElementById('authority-tenders-table-body');
    if (!tableBody) return;

    if (res.tenders.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">No tenders created yet. Click "+ Create New Tender" above.</td></tr>';
      return;
    }

    tableBody.innerHTML = res.tenders.map(t => `
      <tr>
        <td><code>${t.tender_code}</code></td>
        <td><strong>${t.title}</strong></td>
        <td>${t.department}</td>
        <td>${UI.formatCurrency(t.estimated_budget)}</td>
        <td>${UI.formatDate(t.submission_deadline)}</td>
        <td>${UI.getStatusBadge(t.status)}</td>
        <td>
          <div class="btn-group btn-group-sm">
            <button class="btn btn-outline-primary" onclick="viewTenderDetails(${t.id})" title="View Details">
              <i class="bi bi-eye"></i>
            </button>
            ${t.status === 'draft' ? `
              <button class="btn btn-outline-success" onclick="publishTender(${t.id})" title="Publish to Portal">
                <i class="bi bi-send-check"></i> Publish
              </button>
            ` : ''}
            ${t.status === 'published' ? `
              <button class="btn btn-outline-warning" onclick="closeBiddingForTender(${t.id})" title="Close Bidding & Forward to Evaluators">
                <i class="bi bi-lock"></i> Close Bidding
              </button>
            ` : ''}
            <button class="btn btn-outline-secondary" onclick="openUploadDocModal(${t.id}, '${t.tender_code}')" title="Attach Specifications">
              <i class="bi bi-paperclip"></i>
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error loading authority view:', err);
  }
}

window.publishTender = async function(tenderId) {
  if (!confirm('Are you sure you want to publish this tender to the MIT e-Procurement Portal?')) return;
  try {
    const res = await API.tenders.publish(tenderId);
    UI.showToast(res.message, 'success');
    loadAuthorityView();
  } catch (err) {
    UI.showToast(err.message, 'error');
  }
};

window.closeBiddingForTender = async function(tenderId) {
  if (!confirm('Close bidding submissions and move this tender to the Purchase Evaluation Committee?')) return;
  try {
    const res = await API.tenders.closeBidding(tenderId);
    UI.showToast(res.message, 'success');
    loadAuthorityView();
  } catch (err) {
    UI.showToast(err.message, 'error');
  }
};

// ----------------------------------------------------
// 4. CONTRACTOR / BIDDER PORTAL
// ----------------------------------------------------
async function loadContractorView() {
  try {
    // 1. Profile & Status
    const profRes = await API.contractor.getProfile();
    const p = profRes.profile;
    const stats = profRes.stats;

    document.getElementById('contractor-company-name').textContent = p.company_name;
    document.getElementById('contractor-license-num').textContent = p.license_number;
    document.getElementById('contractor-status-pill').innerHTML = UI.getStatusBadge(p.registration_status);

    document.getElementById('contractor-stat-bids').textContent = stats.totalBids;
    document.getElementById('contractor-stat-won').textContent = stats.wonTenders;
    document.getElementById('contractor-stat-active').textContent = stats.activeBids;
    document.getElementById('contractor-stat-value').textContent = UI.formatCurrency(stats.totalAwardedAmount);

    // Warning banner if pending verification
    const alertBanner = document.getElementById('contractor-pending-alert');
    if (alertBanner) {
      if (p.registration_status !== 'approved') {
        alertBanner.classList.remove('d-none');
      } else {
        alertBanner.classList.add('d-none');
      }
    }

    // 2. My Bids List
    const bidsRes = await API.contractor.getMyBids();
    const bidsTable = document.getElementById('contractor-bids-table-body');
    if (bidsTable) {
      if (bidsRes.bids.length === 0) {
        bidsTable.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">No bids submitted yet. Explore open tenders in the public directory to apply.</td></tr>';
      } else {
        bidsTable.innerHTML = bidsRes.bids.map(b => `
          <tr>
            <td><code>${b.tender_code}</code></td>
            <td><strong>${b.tender_title}</strong></td>
            <td>${b.department}</td>
            <td class="fw-bold text-success">${UI.formatCurrency(b.bid_amount)}</td>
            <td>${UI.formatDate(b.submission_date)}</td>
            <td>${UI.getStatusBadge(b.status)}</td>
            <td>
              <button class="btn btn-sm btn-outline-primary" onclick="viewTenderDetails(${b.tender_id})">
                <i class="bi bi-eye"></i> Details
              </button>
            </td>
          </tr>
        `).join('');
      }
    }

    // 3. Load Payment Obligations & History
    await loadContractorPaymentsHistory();
    await loadContractorAwardedContracts();
    await loadContractorEmdRefunds();
  } catch (err) {
    console.error('Error loading contractor view:', err);
  }
}

window.openBidModalForTender = async function(tenderId, tenderCode, title) {
  if (!currentUser) {
    UI.showToast('Please sign in with your Contractor account to submit a bid.', 'info');
    const authModal = new bootstrap.Modal(document.getElementById('authModal'));
    authModal.show();
    return;
  }
  if (currentUser.role !== 'contractor') {
    UI.showToast('Only verified Contractors/Bidders can submit quotations.', 'error');
    return;
  }

  // Pre-flight Payment Verification: Prevent applying or opening bid form without payment
  try {
    const payStatus = await API.payments.getTenderStatus(tenderId);
    if (!payStatus || !payStatus.allPaid) {
      UI.showToast('Payment Required: You must pay the Tender Application Fee and EMD before applying for this tender.', 'warning');
      window.viewTenderDetails(tenderId);
      return;
    }
  } catch (payErr) {
    console.warn('Could not verify payment status before opening bid modal:', payErr);
    UI.showToast('Could not verify fee payment compliance. Opening tender specifications.', 'warning');
    window.viewTenderDetails(tenderId);
    return;
  }

  document.getElementById('bid-form-tender-id').value = tenderId;
  document.getElementById('bid-form-tender-code').textContent = tenderCode;
  document.getElementById('bid-form-tender-title').textContent = title;

  const modal = new bootstrap.Modal(document.getElementById('submitBidModal'));
  modal.show();
};

// ----------------------------------------------------
// 5. EVALUATOR DESK & COMPARATIVE STATEMENT
// ----------------------------------------------------
async function loadEvaluatorView() {
  try {
    const res = await API.evaluation.getTenders();
    const tableBody = document.getElementById('evaluator-tenders-table-body');
    if (!tableBody) return;

    if (res.tenders.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">No tenders pending evaluation at this moment.</td></tr>';
      return;
    }

    tableBody.innerHTML = res.tenders.map(t => `
      <tr>
        <td><code>${t.tender_code}</code></td>
        <td><strong>${t.title}</strong></td>
        <td>${t.department}</td>
        <td>${UI.formatCurrency(t.estimated_budget)}</td>
        <td><span class="badge bg-primary rounded-pill">${t.total_bids} Bids</span></td>
        <td>${UI.getStatusBadge(t.status)}</td>
        <td>
          <button class="btn btn-sm btn-primary" onclick="openEvaluationDeskForTender(${t.id})">
            <i class="bi bi-sliders me-1"></i> Comparative Desk
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error loading evaluator view:', err);
  }
}

window.openEvaluationDeskForTender = async function(tenderId) {
  try {
    const res = await API.evaluation.getTenderBids(tenderId);
    const t = res.tender;
    const bids = res.bids;

    document.getElementById('eval-desk-tender-code').textContent = t.tender_code;
    document.getElementById('eval-desk-tender-title').textContent = t.title;
    document.getElementById('eval-desk-budget').textContent = UI.formatCurrency(t.estimated_budget);
    document.getElementById('eval-desk-status').innerHTML = UI.getStatusBadge(t.status);

    const bidsTable = document.getElementById('eval-desk-bids-table-body');
    if (!bidsTable) return;

    if (bids.length === 0) {
      bidsTable.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4">No bids submitted for this tender.</td></tr>';
    } else {
      bidsTable.innerHTML = bids.map((b, idx) => `
        <tr class="${b.is_l1 ? 'row-l1' : ''}">
          <td>
            ${b.is_l1 ? '<span class="badge-l1">Lowest (Rank 1)</span>' : `<span class="badge bg-secondary">${b.financial_rank}</span>`}
          </td>
          <td>
            <strong>${b.company_name}</strong>
            <div class="text-muted small">${b.license_number}</div>
          </td>
          <td class="fw-bold ${b.is_l1 ? 'text-primary' : 'text-dark'}">
            ${UI.formatCurrency(b.bid_amount)}
            <div class="small text-muted">${b.budget_deviation_percent > 0 ? '+' : ''}${b.budget_deviation_percent}% vs Budget</div>
          </td>
          <td>${b.experience_years} Years</td>
          <td>
            <strong class="text-dark">${b.eval_technical_score || b.technical_score || '-'}</strong> / 100
          </td>
          <td>
            <strong>${b.auto_financial_score}</strong> / 100
          </td>
          <td>
            <span class="badge bg-info text-dark fw-bold">${b.computed_combined_score}</span>
          </td>
          <td>${UI.getStatusBadge(b.status)}</td>
          <td>
            <div class="btn-group btn-group-sm">
              <button class="btn btn-outline-primary" onclick="openScoreModal(${b.id}, '${b.company_name.replace(/'/g, "\\'")}', ${b.bid_amount})">
                <i class="bi bi-pencil-square"></i> Score
              </button>
              ${t.status !== 'awarded' ? `
                <button class="btn btn-success" onclick="awardTenderToBid(${t.id}, ${b.id}, '${b.company_name.replace(/'/g, "\\'")}', ${b.bid_amount})">
                  <i class="bi bi-award"></i> Award
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `).join('');
    }

    const deskModal = new bootstrap.Modal(document.getElementById('evaluationDeskModal'));
    deskModal.show();
  } catch (err) {
    UI.showToast('Could not load evaluation data: ' + err.message, 'error');
  }
};

window.openScoreModal = function(bidId, companyName, bidAmount) {
  document.getElementById('score-form-bid-id').value = bidId;
  document.getElementById('score-form-company').textContent = companyName;
  document.getElementById('score-form-amount').textContent = UI.formatCurrency(bidAmount);

  const modal = new bootstrap.Modal(document.getElementById('scoreBidModal'));
  modal.show();
};

window.awardTenderToBid = async function(tenderId, bidId, companyName, bidAmount) {
  const notes = prompt(`Confirm contract award to ${companyName} for accepted quote of ${UI.formatCurrency(bidAmount)}?\n\nEnter Purchase Committee Approval Notes:`, `Approved by MIT Purchase & Technical Evaluation Committee.`);
  if (!notes) return;

  try {
    const res = await API.evaluation.awardTender({
      tender_id: tenderId,
      bid_id: bidId,
      award_notes: notes
    });

    UI.showToast(res.message, 'success');
    loadEvaluatorView();
    const deskModal = bootstrap.Modal.getInstance(document.getElementById('evaluationDeskModal'));
    if (deskModal) deskModal.hide();
  } catch (err) {
    UI.showToast(err.message, 'error');
  }
};

// ----------------------------------------------------
// 6. ADMIN DASHBOARD VIEW
window.currentAdminVendorFilter = 'all';
window.currentAdminStaffFilter = 'all';

async function loadAdminView() {
  try {
    // Admin Notification Banner
    const bannerEl = document.getElementById('admin-mode-banner');
    if (bannerEl) {
      bannerEl.innerHTML = `
        <div class="alert alert-primary bg-primary bg-opacity-10 border-0 rounded-4 d-flex align-items-center gap-3 p-3 mb-4">
          <i class="bi bi-shield-check fs-3 text-primary"></i>
          <div>
            <div class="fw-bold text-dark">MIT Central Administration Active</div>
            <small class="text-muted">You have full administrative authority to verify institutional staff requests, review contractor KYC, manage tenders, and inspect real-time audit logs.</small>
          </div>
        </div>
      `;
    }

    const statsRes = await API.admin.getStats();
    const s = statsRes.stats || {};

    const elUsers = document.getElementById('admin-stat-users');
    const elContractors = document.getElementById('admin-stat-contractors');
    const elPending = document.getElementById('admin-stat-pending');
    const elBudget = document.getElementById('admin-stat-budget');
    const elTenders = document.getElementById('admin-stat-tenders');

    if (elUsers) elUsers.textContent = s.totalUsers || 0;
    if (elContractors) elContractors.textContent = s.totalContractors || 0;
    if (elPending) elPending.textContent = (s.pendingContractors || 0) + (s.pendingInstitutionalUsers || 0);
    if (elBudget) elBudget.textContent = UI.formatCurrency(s.totalBudget || 0);
    if (elTenders) elTenders.textContent = s.totalTenders || 0;

    // 1. Institutional Staff Requests & Approvals Table (Authority & Evaluators)
    const usersRes = await API.admin.getUsers();
    const allUsers = usersRes.users || [];
    const staffMembers = allUsers.filter(u => ['authority', 'evaluator'].includes(u.role));
    const pendingStaffCount = staffMembers.filter(u => u.status === 'pending').length;

    const staffBadgeEl = document.getElementById('admin-pending-staff-badge');
    if (staffBadgeEl) {
      staffBadgeEl.textContent = `${pendingStaffCount} Pending`;
      staffBadgeEl.className = `badge ${pendingStaffCount > 0 ? 'bg-warning text-dark' : 'bg-success text-white'} rounded-pill ms-2`;
    }

    let displayedStaff = staffMembers;
    if (window.currentAdminStaffFilter && window.currentAdminStaffFilter !== 'all') {
      displayedStaff = staffMembers.filter(u => u.status === window.currentAdminStaffFilter);
    }

    const staffTable = document.getElementById('admin-staff-table-body');
    if (staffTable) {
      if (displayedStaff.length === 0) {
        staffTable.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4"><i class="bi bi-person-x display-6 d-block mb-2 text-secondary"></i>No institutional staff records found for filter: <strong>${window.currentAdminStaffFilter.toUpperCase()}</strong>.</td></tr>`;
      } else {
        staffTable.innerHTML = displayedStaff.map(u => `
          <tr class="${u.status === 'pending' ? 'table-warning bg-opacity-25' : u.status === 'invited' ? 'table-info bg-opacity-10' : ''}">
            <td>
              <strong>${u.name}</strong>
              <div><span class="badge bg-light text-dark font-monospace border" style="font-size: 0.72rem;">${u.employee_id || 'ID: UNASSIGNED'}</span></div>
            </td>
            <td>
              <strong class="text-dark">${u.designation || 'Faculty / Procurement Officer'}</strong>
              <div class="small text-muted">${u.department || 'Central Purchase Committee'}</div>
            </td>
            <td>
              <code>${u.email}</code>
              ${u.phone ? `<div class="small text-muted"><i class="bi bi-telephone me-1"></i>${u.phone}</div>` : ''}
            </td>
            <td><span class="badge ${u.role === 'authority' ? 'bg-warning text-dark' : 'bg-info text-dark'}">${u.role.toUpperCase()}</span></td>
            <td>
              ${UI.getStatusBadge(u.status)}
              ${u.status === 'invited' ? '<div class="text-muted" style="font-size: 0.7rem;"><i class="bi bi-clock me-1"></i>Invitation Dispatched</div>' : ''}
            </td>
            <td>
              <div class="btn-group btn-group-sm">
                <button class="btn btn-outline-primary" onclick="openStaffRequestDetailsModal(${u.id})" title="View Complete Details">
                  <i class="bi bi-eye me-1"></i> Details
                </button>
                ${u.status === 'pending' ? `
                  <button class="btn btn-success" onclick="approveStaffRequest(${u.id})" title="Approve & Send Invitation Link">
                    <i class="bi bi-check-lg me-1"></i> Approve
                  </button>
                ` : ''}
                ${u.status === 'invited' ? `
                  <button class="btn btn-outline-success" onclick="resendStaffInvitation(${u.id})" title="Resend Official Invitation Email">
                    <i class="bi bi-send me-1"></i> Resend
                  </button>
                  <button class="btn btn-outline-secondary" onclick="copyStaffInviteLink('${u.email}', '${u.invitation_token || ''}')" title="Copy Setup Link to Clipboard">
                    <i class="bi bi-clipboard me-1"></i> Link
                  </button>
                ` : ''}
                ${u.status !== 'rejected' && u.status !== 'active' ? `
                  <button class="btn btn-outline-danger" onclick="rejectStaffRequest(${u.id})" title="Reject Request">
                    <i class="bi bi-x-lg me-1"></i> Reject
                  </button>
                ` : ''}
                ${u.status === 'rejected' ? `
                  <button class="btn btn-danger" onclick="deleteStaffRequest(${u.id})" title="Permanently Delete Rejected Request from Database & Dashboard">
                    <i class="bi bi-trash me-1"></i> Delete
                  </button>
                ` : ''}
              </div>
            </td>
          </tr>
        `).join('');
      }
    }

    // 2. Contractors verification table
    const contractorsRes = await API.admin.getContractors();
    const allContractors = contractorsRes.contractors || [];
    
    // Update pending queue badge
    const pendingCount = allContractors.filter(c => c.registration_status === 'pending').length;
    const badgeEl = document.getElementById('admin-pending-queue-badge');
    if (badgeEl) {
      badgeEl.textContent = `${pendingCount} Pending`;
      badgeEl.className = `badge ${pendingCount > 0 ? 'bg-warning text-dark' : 'bg-success text-white'} rounded-pill ms-2`;
    }

    // Filter list
    let displayedContractors = allContractors;
    if (window.currentAdminVendorFilter && window.currentAdminVendorFilter !== 'all') {
      displayedContractors = allContractors.filter(c => c.registration_status === window.currentAdminVendorFilter);
    }

    const cTable = document.getElementById('admin-contractors-table-body');
    if (cTable) {
      if (displayedContractors.length === 0) {
        cTable.innerHTML = `
          <tr>
            <td colspan="7" class="text-center text-muted py-4">
              <i class="bi bi-person-x display-6 d-block mb-2 text-secondary"></i>
              No contractors found for filter: <strong>${window.currentAdminVendorFilter.toUpperCase()}</strong>.
            </td>
          </tr>
        `;
      } else {
        cTable.innerHTML = displayedContractors.map(c => `
          <tr class="${c.registration_status === 'pending' ? 'table-warning bg-opacity-25' : ''}">
            <td>
              <strong>${c.company_name}</strong>
              <div class="small text-muted">${c.address || 'MIDC Chhatrapati Sambhajinagar'}</div>
            </td>
            <td><code>${c.license_number}</code></td>
            <td>
              <div class="small"><strong>GST:</strong> ${c.gst_number || 'N/A'}</div>
              <div class="small"><strong>PAN:</strong> ${c.pan_number || 'N/A'}</div>
            </td>
            <td>
              <div class="fw-semibold text-dark">${c.user_name}</div>
              <div class="small text-muted"><i class="bi bi-envelope me-1"></i>${c.user_email} ${c.user_phone ? `| <i class="bi bi-telephone me-1"></i>${c.user_phone}` : ''}</div>
            </td>
            <td><strong>${c.experience_years}</strong> Years</td>
            <td>${UI.getStatusBadge(c.registration_status)}</td>
            <td>
              <div class="btn-group btn-group-sm">
                ${c.registration_status !== 'approved' ? `
                  <button class="btn btn-success" onclick="verifyContractor(${c.id}, 'approved')" title="Approve & Verify Vendor for Bidding">
                    <i class="bi bi-check-lg me-1"></i> Approve
                  </button>
                ` : ''}
                ${c.registration_status !== 'rejected' ? `
                  <button class="btn btn-outline-danger" onclick="verifyContractor(${c.id}, 'rejected')" title="Reject Vendor">
                    <i class="bi bi-x-lg me-1"></i> Reject
                  </button>
                ` : ''}
                ${c.registration_status === 'approved' ? `
                  <span class="badge bg-success bg-opacity-10 text-success p-1.5"><i class="bi bi-patch-check-fill me-1"></i> Verified</span>
                ` : ''}
                ${c.registration_status === 'rejected' ? `
                  <button class="btn btn-danger" onclick="deleteContractorRequest(${c.id})" title="Permanently Delete Rejected Vendor from Database & Queue">
                    <i class="bi bi-trash me-1"></i> Delete
                  </button>
                ` : ''}
              </div>
            </td>
          </tr>
        `).join('');
      }
    }

    // 3. Audit logs table
    const logsRes = await API.admin.getAuditLogs();
    const logsTable = document.getElementById('admin-audit-logs-body');
    if (logsTable) {
      if (!logsRes.logs || logsRes.logs.length === 0) {
        logsTable.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4"><i class="bi bi-clock-history display-6 d-block mb-2 text-secondary"></i>No audit logs recorded yet. Real-time security events will appear here as users interact with the portal.</td></tr>';
      } else {
        logsTable.innerHTML = logsRes.logs.slice(0, 20).map(l => `
          <tr>
            <td><span class="badge ${l.action.includes('LOCKOUT') ? 'bg-danger' : l.action.includes('REGISTER') ? 'bg-primary' : 'bg-light text-dark'} font-monospace">${l.action}</span></td>
            <td class="small">${l.details}</td>
            <td>${l.user_name ? `${l.user_name} (${l.user_role})` : 'System'}</td>
            <td class="text-muted small">${UI.formatDateTime(l.created_at)}</td>
          </tr>
        `).join('');
      }
    }

    // 4. Procurement Fee & EMD Payment Management
    await loadAdminPaymentManagement();

    // 5. Contractor Payments Desk (Institution -> Contractor)
    await loadAdminContractorPaymentDesk();

    // 6. EMD Refunds Desk (Institution -> Eligible Contractor)
    await loadAdminEmdRefundDesk();
  } catch (err) {
    console.error('Error loading admin view:', err);
    UI.showToast('Error loading admin dashboard: ' + err.message, 'error');
  }
}

// Institutional Staff Request Actions
window.filterAdminStaff = function(status, btn) {
  window.currentAdminStaffFilter = status;
  if (btn) {
    document.querySelectorAll('#admin-staff-filter-group button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  loadAdminView();
};

window.openStaffRequestDetailsModal = async function(userId) {
  try {
    const res = await API.admin.getUserDetails(userId);
    const u = res.user;

    document.getElementById('staff-detail-user-id').value = u.id;
    document.getElementById('staff-detail-name').textContent = u.name;
    document.getElementById('staff-detail-role-badge').textContent = u.role.toUpperCase();
    document.getElementById('staff-detail-role-badge').className = `badge ${u.role === 'authority' ? 'bg-warning text-dark' : 'bg-info text-dark'} me-2`;
    document.getElementById('staff-detail-status-badge').innerHTML = UI.getStatusBadge(u.status);
    document.getElementById('staff-detail-empid').textContent = u.employee_id || 'NOT SPECIFIED';
    document.getElementById('staff-detail-designation').textContent = u.designation || 'Faculty / Procurement Officer';
    document.getElementById('staff-detail-email').textContent = u.email;
    document.getElementById('staff-detail-phone').textContent = u.phone || 'N/A';
    document.getElementById('staff-detail-dept').textContent = u.department || 'Central Purchase Committee';
    document.getElementById('staff-detail-date').textContent = UI.formatDateTime(u.created_at);
    document.getElementById('staff-detail-justification').textContent = u.justification || 'Standard departmental procurement access request.';

    const inviteSec = document.getElementById('staff-detail-invitation-section');
    const appUrl = window.location.origin;
    const invLink = u.invitation_link || (u.invitation_token ? `${appUrl}/#set-password?token=${u.invitation_token}&email=${encodeURIComponent(u.email)}` : '');

    if (u.status === 'invited' && invLink) {
      if (inviteSec) {
        inviteSec.classList.remove('d-none');
        document.getElementById('staff-detail-invitation-link').value = invLink;
        document.getElementById('staff-detail-invitation-token').textContent = u.invitation_token || '';
      }
    } else {
      if (inviteSec) inviteSec.classList.add('d-none');
    }

    const approveBtn = document.getElementById('staff-detail-approve-btn');
    if (approveBtn) {
      if (u.status === 'active') {
        approveBtn.disabled = true;
        approveBtn.innerHTML = '<i class="bi bi-check-all me-1"></i> Already Active';
        approveBtn.classList.remove('d-none');
      } else if (u.status === 'invited') {
        approveBtn.disabled = false;
        approveBtn.innerHTML = '<i class="bi bi-arrow-repeat me-1"></i> Resend Invitation Email';
        approveBtn.classList.remove('d-none');
      } else if (u.status === 'rejected') {
        approveBtn.classList.add('d-none');
      } else {
        approveBtn.disabled = false;
        approveBtn.innerHTML = '<i class="bi bi-check-circle me-1"></i> Approve & Send Invitation';
        approveBtn.classList.remove('d-none');
      }
    }

    const rejectBtn = document.getElementById('staff-detail-reject-btn');
    const deleteBtn = document.getElementById('staff-detail-delete-btn');
    if (rejectBtn && deleteBtn) {
      if (u.status === 'rejected') {
        rejectBtn.classList.add('d-none');
        deleteBtn.classList.remove('d-none');
      } else {
        rejectBtn.classList.remove('d-none');
        deleteBtn.classList.add('d-none');
      }
    }

    const modal = new bootstrap.Modal(document.getElementById('staffRequestDetailsModal'));
    modal.show();
  } catch (err) {
    UI.showToast('Could not load staff request details: ' + err.message, 'error');
  }
};

window.approveCurrentStaffRequest = async function() {
  const userId = document.getElementById('staff-detail-user-id').value;
  if (!userId) return;
  await approveStaffRequest(userId);
  const modal = bootstrap.Modal.getInstance(document.getElementById('staffRequestDetailsModal'));
  if (modal) modal.hide();
};

window.rejectCurrentStaffRequest = async function() {
  const userId = document.getElementById('staff-detail-user-id').value;
  if (!userId) return;
  await rejectStaffRequest(userId);
  const modal = bootstrap.Modal.getInstance(document.getElementById('staffRequestDetailsModal'));
  if (modal) modal.hide();
};

window.approveStaffRequest = async function(userId) {
  try {
    const res = await API.admin.approveStaffRequest(userId);
    if (res.warning) {
      UI.showToast(res.message || res.warning, 'warning');
      if (res.invitation_link) {
        prompt(
          `Staff request approved!\n\n⚠️ Note: ${res.warning}\n\nPlease copy and share this password setup link directly with the staff member:`,
          res.invitation_link
        );
      }
    } else {
      UI.showToast(res.message, 'success');
      if (res.invitation_link) {
        prompt(
          `Staff invitation dispatched to email!\n\n(Important: Please check the Gmail Spam/Junk folder if not in Inbox).\n\nYou can also copy the direct password setup link:`,
          res.invitation_link
        );
      }
    }
    loadAdminView();
  } catch (err) {
    UI.showToast(err.message, 'error');
  }
};

window.resendStaffInvitation = async function(userId) {
  await approveStaffRequest(userId);
};

window.copyStaffModalInvitationLink = function() {
  const input = document.getElementById('staff-detail-invitation-link');
  if (input && input.value) {
    navigator.clipboard.writeText(input.value).then(() => {
      UI.showToast('Password setup link copied to clipboard!', 'success');
    }).catch(() => {
      prompt('Password setup link:', input.value);
    });
  }
};

window.copyStaffInviteLink = function(email, token) {
  const appUrl = window.location.origin;
  const link = `${appUrl}/#set-password?token=${token}&email=${encodeURIComponent(email)}`;
  navigator.clipboard.writeText(link).then(() => {
    UI.showToast(`Password setup link copied for ${email}!`, 'success');
  }).catch(() => {
    prompt(`Password setup link for ${email}:`, link);
  });
};

window.resendStaffInvitationFromModal = async function() {
  const userId = document.getElementById('staff-detail-user-id').value;
  if (!userId) return;
  await approveStaffRequest(userId);
};

window.rejectStaffRequest = async function(userId) {
  const reason = prompt('Enter the reason for rejecting this staff access request (will be sent to applicant):', 'Institutional credentials could not be verified against the college faculty/staff roster.');
  if (reason === null) return; // user cancelled

  try {
    const res = await API.admin.rejectStaffRequest(userId, reason);
    UI.showToast(res.message, 'info');
    loadAdminView();

    setTimeout(async () => {
      const delNow = confirm('Staff request has been rejected. Would you like to permanently delete this request from the database and dashboard now?');
      if (delNow) {
        await window.deleteStaffRequest(userId, false);
      }
    }, 250);
  } catch (err) {
    UI.showToast(err.message, 'error');
  }
};

window.deleteStaffRequest = async function(userId, askConfirm = true) {
  if (askConfirm) {
    const confirmed = confirm('Are you sure you want to permanently delete this staff request? It will be removed from the dashboard and database.');
    if (!confirmed) return;
  }

  try {
    const res = await API.admin.deleteStaffRequest(userId);
    UI.showToast(res.message, 'success');
    loadAdminView();
  } catch (err) {
    UI.showToast('Could not delete staff request: ' + err.message, 'error');
  }
};

window.deleteCurrentStaffRequest = async function() {
  const userId = document.getElementById('staff-detail-user-id').value;
  if (!userId) return;
  const modal = bootstrap.Modal.getInstance(document.getElementById('staffRequestDetailsModal'));
  if (modal) modal.hide();
  await window.deleteStaffRequest(userId, true);
};

window.verifyStaffUser = async function(userId, status) {
  try {
    const res = await API.admin.verifyUser(userId, status);
    UI.showToast(res.message, 'success');
    loadAdminView();
  } catch (err) {
    UI.showToast(err.message, 'error');
  }
};

window.filterAdminVendors = function(status, btn) {
  window.currentAdminVendorFilter = status;
  if (btn) {
    document.querySelectorAll('#admin-vendor-filter-group button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  loadAdminView();
};

window.verifyContractor = async function(contractorId, status) {
  try {
    const res = await API.admin.verifyContractor(contractorId, status);
    UI.showToast(res.message, status === 'approved' ? 'success' : 'info');
    loadAdminView();

    if (status === 'rejected') {
      setTimeout(async () => {
        const delNow = confirm('Contractor request has been rejected. Would you like to permanently delete this request from the database and queue now?');
        if (delNow) {
          await window.deleteContractorRequest(contractorId, false);
        }
      }, 250);
    }
  } catch (err) {
    UI.showToast(err.message, 'error');
  }
};

window.deleteContractorRequest = async function(contractorId, askConfirm = true) {
  if (askConfirm) {
    const confirmed = confirm('Are you sure you want to permanently delete this contractor request? It will be removed from the queue and database.');
    if (!confirmed) return;
  }

  try {
    const res = await API.admin.deleteContractor(contractorId);
    UI.showToast(res.message, 'success');
    loadAdminView();
  } catch (err) {
    UI.showToast('Could not delete contractor: ' + err.message, 'error');
  }
};

window.fillSignIn = function(email, password) {
  const emailInput = document.getElementById('signin-email');
  const passInput = document.getElementById('signin-password');
  if (emailInput) emailInput.value = email;
  if (passInput) passInput.value = password;
  UI.showToast(`Pre-filled credentials for ${email}`, 'info');
};

// ----------------------------------------------------
// 7. REPORTS & ANALYTICS VIEW
// ----------------------------------------------------
async function loadReportsView() {
  try {
    const summaryRes = await API.reports.getSummary();
    const d = summaryRes.data;

    renderDepartmentBudgetChart(d.departmentBudgets);
    renderTenderStatusChart(d.statusCounts);

    // History Table with PDF links
    const historyRes = await API.reports.getTenderHistory();
    const historyTable = document.getElementById('reports-history-table-body');
    if (historyTable) {
      if (!historyRes.history || historyRes.history.length === 0) {
        historyTable.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">No tender records found.</td></tr>';
      } else {
        historyTable.innerHTML = historyRes.history.map(t => `
          <tr>
            <td><code>${t.tender_code}</code></td>
            <td><strong>${t.title}</strong></td>
            <td>${t.department}</td>
            <td>${UI.formatCurrency(t.estimated_budget)}</td>
            <td>${t.awarded_amount ? `<strong class="text-success">${UI.formatCurrency(t.awarded_amount)}</strong>` : '-'}</td>
            <td>${t.winner_name || '<span class="text-muted">Not Awarded</span>'}</td>
            <td>${UI.getStatusBadge(t.status)}</td>
            <td>
              <div class="btn-group btn-group-sm">
                <a href="${API.reports.getPdfUrl(t.id, 'comparative')}" target="_blank" class="btn btn-outline-primary" title="Comparative Statement PDF">
                  <i class="bi bi-file-earmark-spreadsheet"></i> Statement
                </a>
                ${t.status === 'awarded' ? `
                  <a href="${API.reports.getPdfUrl(t.id, 'award')}" target="_blank" class="btn btn-outline-success" title="Official Letter of Award (LOA) PDF">
                    <i class="bi bi-award"></i> LOA
                  </a>
                ` : ''}
              </div>
            </td>
          </tr>
        `).join('');
      }
    }

    // Contractor Leaderboard Table
    const perfRes = await API.reports.getContractorPerformance();
    const perfTable = document.getElementById('reports-contractor-perf-body');
    if (perfTable) {
      if (!perfRes.performance || perfRes.performance.length === 0) {
        perfTable.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">No contractor performance records recorded yet.</td></tr>';
      } else {
        perfTable.innerHTML = perfRes.performance.map(p => `
          <tr>
            <td><strong>${p.company_name}</strong></td>
            <td><code>${p.license_number}</code></td>
            <td>${p.total_bids_submitted}</td>
            <td><span class="badge bg-success">${p.tenders_won} Won</span></td>
            <td><strong class="text-primary">${p.win_rate}</strong></td>
            <td>${p.avg_technical_score ? p.avg_technical_score + '/100' : 'N/A'}</td>
            <td class="fw-bold">${UI.formatCurrency(p.total_contract_value)}</td>
          </tr>
        `).join('');
      }
    }

    // Financial Liabilities & EMD Reconciliation Report
    await loadFinancialReport();
  } catch (err) {
    console.error('Error loading reports view:', err);
  }
}

function renderDepartmentBudgetChart(deptData) {
  const ctx = document.getElementById('chart-dept-budget');
  if (!ctx) return;

  if (chartInstances.deptBudget) chartInstances.deptBudget.destroy();

  const hasData = deptData && deptData.length > 0;
  const labels = hasData ? deptData.map(d => d.department.length > 25 ? d.department.substring(0, 25) + '...' : d.department) : ['No Department Tenders'];
  const values = hasData ? deptData.map(d => d.total_budget) : [0];

  chartInstances.deptBudget = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Allocated Budget (₹)',
        data: values,
        backgroundColor: '#1a56db',
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: (val) => '₹' + (val / 100000).toFixed(1) + 'L' }
        }
      }
    }
  });
}

function renderTenderStatusChart(statusData) {
  const ctx = document.getElementById('chart-tender-status');
  if (!ctx) return;

  if (chartInstances.tenderStatus) chartInstances.tenderStatus.destroy();

  const hasData = statusData && statusData.length > 0;
  const labels = hasData ? statusData.map(s => s.status.replace('_', ' ').toUpperCase()) : ['No Tenders'];
  const values = hasData ? statusData.map(s => s.count) : [1];
  const colors = hasData ? ['#1a56db', '#10b981', '#f59e0b', '#64748b', '#ef4444'] : ['#e2e8f0'];

  chartInstances.tenderStatus = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: colors
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom' } }
    }
  });
}

// ----------------------------------------------------
// MOBILE NAVIGATION DRAWER HELPERS
// ----------------------------------------------------
function openMobileSidebar() {
  const sidebar = document.getElementById('appSidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.add('show');
  if (backdrop) backdrop.classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('appSidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.remove('show');
  if (backdrop) backdrop.classList.remove('show');
  document.body.style.overflow = '';
}

function toggleMobileSidebar() {
  const sidebar = document.getElementById('appSidebar');
  if (sidebar && sidebar.classList.contains('show')) {
    closeMobileSidebar();
  } else {
    openMobileSidebar();
  }
}

// ----------------------------------------------------
// EVENT LISTENERS & FORMS SETUP
// ----------------------------------------------------
function setupEventListeners() {
  // Mobile sidebar drawer triggers
  const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
  const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');

  if (sidebarToggleBtn) {
    sidebarToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMobileSidebar();
    });
  }
  if (sidebarCloseBtn) {
    sidebarCloseBtn.addEventListener('click', () => closeMobileSidebar());
  }
  if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener('click', () => closeMobileSidebar());
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeMobileSidebar();
    }
  });

  // Touch swipe gesture to close mobile drawer on Android/touch devices
  let touchStartX = 0;
  let touchStartY = 0;
  const sidebarEl = document.getElementById('appSidebar');
  if (sidebarEl) {
    sidebarEl.addEventListener('touchstart', (e) => {
      touchStartX = e.changedTouches[0].clientX;
      touchStartY = e.changedTouches[0].clientY;
    }, { passive: true });

    sidebarEl.addEventListener('touchend', (e) => {
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      const diffX = touchEndX - touchStartX;
      const diffY = touchEndY - touchStartY;
      if (diffX < -45 && Math.abs(diffY) < 60) {
        closeMobileSidebar();
      }
    }, { passive: true });
  }

  // Navigation links
  document.querySelectorAll('[data-view]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const view = el.getAttribute('data-view');
      navigateTo(view);
      if (window.innerWidth < 992) {
        closeMobileSidebar();
      }
    });
  });

  // Logout button
  const logoutBtn = document.getElementById('nav-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => logout());
  }

  // Sign In Form Submission
  const signinForm = document.getElementById('signin-form');
  if (signinForm) {
    signinForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('signin-email').value.trim();
      const password = document.getElementById('signin-password').value;

      try {
        const res = await API.auth.login(email, password);
        API.setToken(res.token);
        API.setUser(res.user);
        currentUser = res.user;
        updateNavState(true);

        const authModal = bootstrap.Modal.getInstance(document.getElementById('authModal'));
        if (authModal) authModal.hide();

        UI.showToast(`Welcome back, ${currentUser.name}! Signed in as ${currentUser.role.toUpperCase()}.`, 'success');

        // Route to their primary role workspace
        if (currentUser.role === 'admin') navigateTo('admin');
        else if (currentUser.role === 'authority') navigateTo('authority');
        else if (currentUser.role === 'contractor') navigateTo('contractor');
        else if (currentUser.role === 'evaluator') navigateTo('evaluator');
        else navigateTo('tenders');
      } catch (err) {
        UI.showToast(err.message, 'error');
      }
    });
  }

  // Helper: Client-side Password Policy Checker
  function checkPasswordPolicy(password) {
    if (!password || password.length < 8) {
      return 'Password must be at least 8 characters long.';
    }
    if (!/[A-Z]/.test(password)) {
      return 'Password must contain at least 1 uppercase letter.';
    }
    if (!/[a-z]/.test(password)) {
      return 'Password must contain at least 1 lowercase letter.';
    }
    if (!/[0-9]/.test(password)) {
      return 'Password must contain at least 1 number.';
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      return 'Password must contain at least 1 special character (!@#$%^&* etc).';
    }
    return null;
  }

  // Register Form Submission
  const registerForm = document.getElementById('register-form');
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('reg-name').value.trim();
      const email = document.getElementById('reg-email').value.trim();
      const password = document.getElementById('reg-password').value;
      const confirmPassword = document.getElementById('reg-confirm-password') ? document.getElementById('reg-confirm-password').value : password;
      const role = document.getElementById('reg-role').value;
      const department = document.getElementById('reg-dept').value.trim();
      const phone = document.getElementById('reg-phone').value.trim();

      if (password !== confirmPassword) {
        UI.showToast('Passwords do not match. Please verify your password confirmation.', 'error');
        return;
      }

      const policyError = checkPasswordPolicy(password);
      if (policyError) {
        UI.showToast(policyError, 'error');
        return;
      }

      const payload = { name, email, password, confirmPassword, role, department, phone };

      if (role === 'contractor') {
        payload.company_name = document.getElementById('reg-company') ? document.getElementById('reg-company').value.trim() : '';
        payload.license_number = document.getElementById('reg-license') ? document.getElementById('reg-license').value.trim() : '';
        payload.experience_years = document.getElementById('reg-experience') ? document.getElementById('reg-experience').value : 0;
        payload.gst_number = document.getElementById('reg-gst') ? document.getElementById('reg-gst').value.trim() : '';
        payload.pan_number = document.getElementById('reg-pan') ? document.getElementById('reg-pan').value.trim() : '';
      }

      try {
        const res = await API.auth.register(payload);
        UI.showToast(res.message, 'success');
        registerForm.reset();

        // Switch tab to Sign In and prefill email
        const signinTabBtn = document.getElementById('tab-signin-btn');
        if (signinTabBtn) {
          const tab = new bootstrap.Tab(signinTabBtn);
          tab.show();
        }
        document.getElementById('signin-email').value = email;
        document.getElementById('signin-password').value = '';
        document.getElementById('signin-password').focus();
      } catch (err) {
        UI.showToast(err.message, 'error');
      }
    });
  }

  // Forgot Password: Request OTP Form
  const forgotReqForm = document.getElementById('forgot-password-request-form');
  if (forgotReqForm) {
    forgotReqForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('forgot-email').value.trim();
      if (!email) {
        UI.showToast('Please provide your registered email address.', 'error');
        return;
      }

      const btn = document.getElementById('forgot-send-btn');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Sending Code...';
      }

      try {
        const res = await API.auth.forgotPassword(email);
        UI.showToast(res.message, 'success');

        document.getElementById('forgot-target-email-display').textContent = email;
        document.getElementById('forgot-step-1').classList.add('d-none');
        document.getElementById('forgot-step-2').classList.remove('d-none');

        // Check if demo OTP banner is present
        const demoAlert = document.getElementById('forgot-demo-otp-alert');
        if (demoAlert) {
          demoAlert.classList.add('d-none'); // Raw OTP is never exposed in API responses in secure mode
        }

        const newPassInput = document.getElementById('reset-new-password');
        if (newPassInput) newPassInput.focus();
      } catch (err) {
        UI.showToast(err.message, 'error');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="bi bi-send me-1"></i> Send Verification Code';
        }
      }
    });
  }

  // Forgot Password: Reset Password Form
  const forgotResetForm = document.getElementById('forgot-password-reset-form');
  if (forgotResetForm) {
    forgotResetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('forgot-target-email-display').textContent.trim();
      const otp = document.getElementById('reset-otp').value.trim();
      const newPassword = document.getElementById('reset-new-password').value;
      const confirmPassword = document.getElementById('reset-confirm-password').value;

      if (!otp) {
        UI.showToast('Please enter the 6-digit verification code.', 'error');
        return;
      }

      if (newPassword !== confirmPassword) {
        UI.showToast('Passwords do not match. Please verify your new password confirmation.', 'error');
        return;
      }

      const policyError = checkPasswordPolicy(newPassword);
      if (policyError) {
        UI.showToast(policyError, 'error');
        return;
      }

      const btn = document.getElementById('reset-submit-btn');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Resetting Password...';
      }

      try {
        const res = await API.auth.resetPassword({ email, otp, newPassword, confirmPassword });
        UI.showToast(res.message, 'success');

        // Close forgot modal
        const forgotModal = bootstrap.Modal.getInstance(document.getElementById('forgotPasswordModal'));
        if (forgotModal) forgotModal.hide();

        // Open Auth modal on sign in tab and prefill
        const authModal = new bootstrap.Modal(document.getElementById('authModal'));
        authModal.show();
        const signinTabBtn = document.getElementById('tab-signin-btn');
        if (signinTabBtn) {
          const tab = new bootstrap.Tab(signinTabBtn);
          tab.show();
        }
        document.getElementById('signin-email').value = email;
        document.getElementById('signin-password').value = '';
        document.getElementById('signin-password').focus();
      } catch (err) {
        UI.showToast(err.message, 'error');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="bi bi-check-circle me-1"></i> Update & Set New Password';
        }
      }
    });
  }

  // Create Tender Form (Authority)
  const createTenderForm = document.getElementById('create-tender-form');
  if (createTenderForm) {
    createTenderForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(createTenderForm);

      try {
        const res = await API.tenders.create(formData);
        UI.showToast(res.message, 'success');
        const modal = bootstrap.Modal.getInstance(document.getElementById('createTenderModal'));
        if (modal) modal.hide();
        createTenderForm.reset();
        loadAuthorityView();
      } catch (err) {
        UI.showToast(err.message, 'error');
      }
    });
  }

  // Submit Bid Form (Contractor)
  const submitBidForm = document.getElementById('submit-bid-form');
  if (submitBidForm) {
    submitBidForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(submitBidForm);

      try {
        const res = await API.contractor.submitBid(formData);
        UI.showToast(res.message, 'success');
        const modal = bootstrap.Modal.getInstance(document.getElementById('submitBidModal'));
        if (modal) modal.hide();
        submitBidForm.reset();
        navigateTo('contractor');
      } catch (err) {
        UI.showToast(err.message, 'error');
        if (err.paymentRequired) {
          const modal = bootstrap.Modal.getInstance(document.getElementById('submitBidModal'));
          if (modal) modal.hide();
          const tenderId = document.getElementById('bid-form-tender-id').value;
          if (tenderId) window.viewTenderDetails(tenderId);
        }
      }
    });
  }

  // Score Bid Form (Evaluator)
  const scoreBidForm = document.getElementById('score-bid-form');
  if (scoreBidForm) {
    scoreBidForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const bid_id = document.getElementById('score-form-bid-id').value;
      const technical_score = document.getElementById('score-tech-input').value;
      const comments = document.getElementById('score-comments-input').value;
      const recommendation = document.getElementById('score-rec-input').value;

      try {
        const res = await API.evaluation.scoreBid({
          bid_id,
          technical_score,
          comments,
          recommendation
        });

        UI.showToast(res.message, 'success');
        const modal = bootstrap.Modal.getInstance(document.getElementById('scoreBidModal'));
        if (modal) modal.hide();
        scoreBidForm.reset();
        
        // Refresh desk
        const tenderCode = document.getElementById('eval-desk-tender-code').textContent;
        const allTenders = await API.tenders.getAll();
        const curT = allTenders.tenders.find(x => x.tender_code === tenderCode);
        if (curT) openEvaluationDeskForTender(curT.id);
      } catch (err) {
        UI.showToast(err.message, 'error');
      }
    });
  }

  // Provision Institutional Staff Form (Admin)
  const provStaffForm = document.getElementById('provision-staff-form');
  if (provStaffForm) {
    provStaffForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('prov-name').value.trim();
      const email = document.getElementById('prov-email').value.trim();
      const role = document.getElementById('prov-role').value;
      const department = document.getElementById('prov-dept').value;
      const phone = document.getElementById('prov-phone').value.trim();
      const password = document.getElementById('prov-password').value;

      const policyError = checkPasswordPolicy(password);
      if (policyError) {
        UI.showToast(policyError, 'error');
        return;
      }

      const btn = document.getElementById('prov-submit-btn');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Provisioning...';
      }

      try {
        const res = await API.admin.createUser({ name, email, role, department, phone, password });
        UI.showToast(res.message, 'success');
        const modal = bootstrap.Modal.getInstance(document.getElementById('provisionStaffModal'));
        if (modal) modal.hide();
        provStaffForm.reset();
        loadAdminView();
      } catch (err) {
        UI.showToast(err.message, 'error');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="bi bi-check2-circle me-1"></i> Provision & Activate Account';
        }
      }
    });
  }

  // Institutional Staff Access Request Form
  const staffReqForm = document.getElementById('staff-request-form');
  if (staffReqForm) {
    staffReqForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('staff-req-name').value.trim();
      const email = document.getElementById('staff-req-email').value.trim();
      const role = document.getElementById('staff-req-role').value;
      const employee_id = document.getElementById('staff-req-empid').value.trim();
      const designation = document.getElementById('staff-req-designation').value.trim();
      const department = document.getElementById('staff-req-dept').value;
      const phone = document.getElementById('staff-req-phone').value.trim();
      const justification = document.getElementById('staff-req-justification').value.trim();

      const btn = document.getElementById('staff-req-submit-btn');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Submitting Request...';
      }

      try {
        const res = await API.auth.requestStaffAccount({
          name,
          email,
          role,
          employee_id,
          designation,
          department,
          phone,
          justification
        });

        UI.showToast(res.message, 'success');
        staffReqForm.reset();

        // Switch to sign in tab and fill email
        const signinTabBtn = document.getElementById('tab-signin-btn');
        if (signinTabBtn) {
          const tab = new bootstrap.Tab(signinTabBtn);
          tab.show();
        }
        const signinEmailInput = document.getElementById('signin-email');
        if (signinEmailInput) {
          signinEmailInput.value = email;
        }
      } catch (err) {
        UI.showToast(err.message, 'error');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="bi bi-send-check me-1"></i> Submit Access Request';
        }
      }
    });
  }

  // Set Password & Accept Invitation Form
  const setPassForm = document.getElementById('set-password-form');
  if (setPassForm) {
    setPassForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('setpass-email').value.trim();
      const token = document.getElementById('setpass-token').value.trim();
      const password = document.getElementById('setpass-password').value;
      const confirmPassword = document.getElementById('setpass-confirm-password').value;

      if (!token || !email || !password) {
        UI.showToast('Please fill out all required fields.', 'error');
        return;
      }

      if (password !== confirmPassword) {
        UI.showToast('Passwords do not match. Please verify your new password confirmation.', 'error');
        return;
      }

      const policyError = checkPasswordPolicy(password);
      if (policyError) {
        UI.showToast(policyError, 'error');
        return;
      }

      const btn = document.getElementById('setpass-submit-btn');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Activating Account...';
      }

      try {
        const res = await API.auth.setPassword({ token, email, password, confirmPassword });
        UI.showToast(res.message, 'success');

        const modal = bootstrap.Modal.getInstance(document.getElementById('setPasswordModal'));
        if (modal) modal.hide();
        setPassForm.reset();

        // Open Auth modal on sign in tab and prefill
        const authModal = new bootstrap.Modal(document.getElementById('authModal'));
        authModal.show();
        const signinTabBtn = document.getElementById('tab-signin-btn');
        if (signinTabBtn) {
          const tab = new bootstrap.Tab(signinTabBtn);
          tab.show();
        }
        document.getElementById('signin-email').value = email;
        document.getElementById('signin-password').value = '';
        document.getElementById('signin-password').focus();
      } catch (err) {
        UI.showToast(err.message, 'error');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="bi bi-check2-circle me-1"></i> Activate Account & Set Password';
        }
      }
    });
  }

  // Filter triggers
  const searchInput = document.getElementById('tender-search-input');
  const deptSelect = document.getElementById('tender-dept-filter');
  const statusSelect = document.getElementById('tender-status-filter');

  if (searchInput) searchInput.addEventListener('input', () => loadTendersView());
  if (deptSelect) deptSelect.addEventListener('change', () => loadTendersView());
  if (statusSelect) statusSelect.addEventListener('change', () => loadTendersView());
}

// Set Password & Accept Invitation Modal Controls
window.openSetPasswordModal = function(token = '', email = '') {
  const authModalEl = document.getElementById('authModal');
  const authModal = bootstrap.Modal.getInstance(authModalEl);
  if (authModal) authModal.hide();

  const emailInput = document.getElementById('setpass-email');
  const tokenInput = document.getElementById('setpass-token');
  const passInput = document.getElementById('setpass-password');
  const confirmInput = document.getElementById('setpass-confirm-password');

  if (emailInput && email) emailInput.value = email;
  if (tokenInput && token) tokenInput.value = token;
  if (passInput) passInput.value = '';
  if (confirmInput) confirmInput.value = '';

  const modal = new bootstrap.Modal(document.getElementById('setPasswordModal'));
  modal.show();
};

// Institutional Staff Provisioning Modal Controls
window.openProvisionStaffModal = function() {
  const form = document.getElementById('provision-staff-form');
  if (form) form.reset();
  const modal = new bootstrap.Modal(document.getElementById('provisionStaffModal'));
  modal.show();
};

// Check admin status helper
async function refreshAdminStatus() {
  // Admin public registration is restricted; nothing required
}

// Forgot Password Modal Controls
window.openForgotPasswordModal = function() {
  const authModalEl = document.getElementById('authModal');
  const authModal = bootstrap.Modal.getInstance(authModalEl);
  if (authModal) authModal.hide();

  document.getElementById('forgot-step-1').classList.remove('d-none');
  document.getElementById('forgot-step-2').classList.add('d-none');
  const demoAlert = document.getElementById('forgot-demo-otp-alert');
  if (demoAlert) demoAlert.classList.add('d-none');

  const reqForm = document.getElementById('forgot-password-request-form');
  if (reqForm) reqForm.reset();
  const resetForm = document.getElementById('forgot-password-reset-form');
  if (resetForm) resetForm.reset();

  const forgotModal = new bootstrap.Modal(document.getElementById('forgotPasswordModal'));
  forgotModal.show();
};

window.backToForgotStep1 = function() {
  document.getElementById('forgot-step-1').classList.remove('d-none');
  document.getElementById('forgot-step-2').classList.add('d-none');
  const demoAlert = document.getElementById('forgot-demo-otp-alert');
  if (demoAlert) demoAlert.classList.add('d-none');
};

// Role Selection in Registration Tab
window.onRoleSelectionChange = function(role) {
  const regRoleInput = document.getElementById('reg-role');
  if (regRoleInput) regRoleInput.value = role;

  // Visual card highlighting
  document.querySelectorAll('.role-select-card').forEach(card => {
    card.classList.remove('border-primary', 'bg-primary', 'bg-opacity-10');
    card.classList.add('border-light');
  });

  const activeCard = document.getElementById(`role-card-${role}`);
  if (activeCard) {
    activeCard.classList.remove('border-light');
    activeCard.classList.add('border-primary', 'bg-primary', 'bg-opacity-10');
  }

  const contractorFields = document.getElementById('register-contractor-fields');
  const companyInput = document.getElementById('reg-company');
  const licenseInput = document.getElementById('reg-license');

  if (role === 'contractor') {
    if (contractorFields) contractorFields.classList.remove('d-none');
    if (companyInput) companyInput.required = true;
    if (licenseInput) licenseInput.required = true;
  } else {
    if (contractorFields) contractorFields.classList.add('d-none');
    if (companyInput) companyInput.required = false;
    if (licenseInput) licenseInput.required = false;
  }
};

window.openUploadDocModal = function(tenderId, tenderCode) {
  document.getElementById('upload-doc-tender-id').value = tenderId;
  document.getElementById('upload-doc-tender-code').textContent = tenderCode;
  const modal = new bootstrap.Modal(document.getElementById('uploadDocModal'));
  modal.show();
};

window.logout = function() {
  API.removeToken();
  API.removeUser();
  currentUser = null;
  updateNavState(false);
  UI.showToast('You have been signed out successfully.', 'info');
  navigateTo('landing');
};

// ========================================================================
// PAYMENT MODULE CONTROLLER (TENDER FEES & EMD SECURITY DEPOSITS)
// ========================================================================

window.currentViewingPayment = null;
window.currentAdminPaymentPage = 1;

/**
 * Initiates Razorpay Checkout payment for Tender Application Fee or EMD
 */
window.initiatePayment = async function(paymentType) {
  if (!currentUser || currentUser.role !== 'contractor') {
    UI.showToast('Please sign in with your verified contractor account to pay fees.', 'error');
    return;
  }

  const tender = window.currentViewingTender;
  if (!tender) {
    UI.showToast('No tender selected.', 'error');
    return;
  }

  const payBtn = paymentType === 'TENDER_FEE' 
    ? document.getElementById('btn-pay-tender-fee') 
    : document.getElementById('btn-pay-emd');
  const originalBtnHtml = payBtn ? payBtn.innerHTML : '';

  if (payBtn) {
    payBtn.disabled = true;
    payBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status"></span> Preparing...';
  }

  try {
    // 1. Check Gateway Configuration
    const configRes = await API.payments.getConfig();
    const config = configRes.config;

    if (!config.isConfigured) {
      // Missing credentials in server environment - show setup modal
      const noticeModal = new bootstrap.Modal(document.getElementById('paymentGatewayNoticeModal'));
      noticeModal.show();
      if (payBtn) {
        payBtn.disabled = false;
        payBtn.innerHTML = originalBtnHtml;
      }
      return;
    }

    // 2. Create Order on Backend (server-calculated amount)
    const order = await API.payments.createOrder(tender.id, paymentType);

    // 3. Launch Official Razorpay Checkout Modal
    const options = {
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      name: 'MIT Chhatrapati Sambhajinagar',
      description: order.description,
      order_id: order.orderId,
      prefill: {
        name: currentUser.name,
        email: currentUser.email,
        contact: currentUser.phone || ''
      },
      notes: {
        tenderCode: order.tenderCode,
        paymentType: order.paymentType,
        receiptNo: order.receiptNo
      },
      theme: {
        color: '#1a56db'
      },
      modal: {
        ondismiss: function() {
          UI.showToast('Payment window closed. No funds were debited.', 'info');
          if (payBtn) {
            payBtn.disabled = false;
            payBtn.innerHTML = originalBtnHtml;
          }
        }
      },
      handler: async function(response) {
        try {
          UI.showToast('Verifying payment signature with MIT server...', 'info');
          const verifyResult = await API.payments.verify({
            provider_order_id: response.razorpay_order_id,
            provider_payment_id: response.razorpay_payment_id,
            provider_signature: response.razorpay_signature,
            payment_id: order.paymentId
          });

          if (verifyResult.success) {
            UI.showToast(`Payment verified successfully! Official Receipt: ${verifyResult.payment.receipt_no}`, 'success');
            await viewTenderDetails(tender.id);
            if (currentView === 'contractor') {
              loadContractorPaymentsHistory();
            }
            if (currentView === 'tenders') {
              loadTendersView();
            }
            openPaymentReceiptModal(verifyResult.payment);
          }
        } catch (verr) {
          UI.showToast('Payment verification failed: ' + verr.message, 'error');
        } finally {
          if (payBtn) {
            payBtn.disabled = false;
            payBtn.innerHTML = originalBtnHtml;
          }
        }
      }
    };

    if (typeof Razorpay === 'undefined') {
      throw new Error('Razorpay Checkout SDK is not loaded. Please verify your internet connection.');
    }

    const rzp = new Razorpay(options);
    rzp.on('payment.failed', function(response) {
      UI.showToast(`Payment failed: ${response.error.description}`, 'error');
      if (payBtn) {
        payBtn.disabled = false;
        payBtn.innerHTML = originalBtnHtml;
      }
    });

    rzp.open();
  } catch (err) {
    if (err.alreadyPaid) {
      UI.showToast(err.message, 'info');
      await viewTenderDetails(tender.id);
    } else {
      UI.showToast('Payment Error: ' + err.message, 'error');
    }
    if (payBtn) {
      payBtn.disabled = false;
      payBtn.innerHTML = originalBtnHtml;
    }
  }
};

/**
 * Loads receipt for a specific obligation from Tender Details modal
 */
window.viewReceiptFromTender = async function(paymentType) {
  const tender = window.currentViewingTender;
  if (!tender) return;

  try {
    const payStatus = await API.payments.getTenderStatus(tender.id);
    const payment = paymentType === 'TENDER_FEE' ? payStatus.tenderFee.payment : payStatus.emd.payment;
    if (payment) {
      openPaymentReceiptModal(payment);
    } else {
      UI.showToast('No receipt record found for this obligation.', 'info');
    }
  } catch (err) {
    UI.showToast('Error retrieving receipt: ' + err.message, 'error');
  }
};

/**
 * Displays the Institutional Payment Receipt Modal
 */
window.openPaymentReceiptModal = function(payment) {
  window.currentViewingPayment = payment;

  document.getElementById('receipt-modal-no').textContent = payment.receipt_no;
  document.getElementById('receipt-modal-contractor').textContent = payment.company_name || currentUser.name;
  document.getElementById('receipt-modal-license').textContent = payment.license_number || 'N/A';
  document.getElementById('receipt-modal-gstin').textContent = payment.gst_number || 'Registered Vendor';

  document.getElementById('receipt-modal-tender-code').textContent = payment.tender_code || '-';
  document.getElementById('receipt-modal-tender-title').textContent = payment.tender_title || '-';
  document.getElementById('receipt-modal-department').textContent = payment.department || 'Central Purchase Committee';

  const typeName = payment.payment_type === 'TENDER_FEE' 
    ? 'Tender Application & Tender Document Fee' 
    : 'Earnest Money Deposit (EMD)';
  document.getElementById('receipt-modal-type').textContent = typeName;
  document.getElementById('receipt-modal-amount').textContent = UI.formatCurrency(payment.amount_rupees);
  document.getElementById('receipt-modal-words').textContent = payment.amount_rupees ? `${UI.formatCurrency(payment.amount_rupees)} (Verified)` : '-';

  document.getElementById('receipt-modal-status').textContent = payment.payment_status;
  document.getElementById('receipt-modal-status').className = `badge ${payment.payment_status === 'PAID' ? 'bg-success' : 'bg-warning text-dark'} ms-1`;
  document.getElementById('receipt-modal-provider').textContent = (payment.payment_provider || 'Razorpay').toUpperCase();
  document.getElementById('receipt-modal-mode').textContent = (payment.payment_mode || 'TEST').toUpperCase();
  document.getElementById('receipt-modal-date').textContent = UI.formatDateTime(payment.paid_at || payment.created_at);

  document.getElementById('receipt-modal-order-id').textContent = payment.provider_order_id || 'N/A';
  document.getElementById('receipt-modal-payment-id').textContent = payment.provider_payment_id || 'N/A';

  const banner = document.getElementById('receipt-modal-banner');
  if (banner) {
    if (payment.payment_mode === 'live') {
      banner.className = 'alert alert-success py-2 px-3 mb-3 small rounded-3 fw-bold';
      banner.textContent = '✅ VERIFIED INSTITUTIONAL REVENUE TRANSACTION — FUNDS CAPTURED & AUDITED';
    } else {
      banner.className = 'alert alert-warning py-2 px-3 mb-3 small rounded-3 fw-bold';
      banner.textContent = '⚠️ TEST TRANSACTION — NO REAL MONEY TRANSFERRED (DEMO / AUDIT SIMULATION)';
    }
  }

  const proceedBtn = document.getElementById('btn-proceed-to-bid-from-receipt');
  if (proceedBtn) {
    if (payment.tender_id && currentUser && currentUser.role === 'contractor') {
      API.payments.getTenderStatus(payment.tender_id).then(payStatus => {
        if (payStatus && payStatus.allPaid) {
          proceedBtn.classList.remove('d-none');
          proceedBtn.onclick = () => {
            const receiptModal = bootstrap.Modal.getInstance(document.getElementById('paymentReceiptModal'));
            if (receiptModal) receiptModal.hide();
            const detailModal = bootstrap.Modal.getInstance(document.getElementById('tenderDetailModal'));
            if (detailModal) detailModal.hide();
            openBidModalForTender(payment.tender_id, payment.tender_code, payment.tender_title);
          };
        } else {
          proceedBtn.classList.add('d-none');
        }
      }).catch(() => proceedBtn.classList.add('d-none'));
    } else {
      proceedBtn.classList.add('d-none');
    }
  }

  const modal = new bootstrap.Modal(document.getElementById('paymentReceiptModal'));
  modal.show();
};

/**
 * Downloads current official receipt PDF via browser tab
 */
window.downloadCurrentReceiptPdf = function() {
  if (!window.currentViewingPayment || !window.currentViewingPayment.id) {
    UI.showToast('No receipt selected.', 'error');
    return;
  }
  const url = API.payments.getPdfUrl(window.currentViewingPayment.id);
  window.open(url, '_blank');
};

/**
 * Loads contractor payment transactions table in Contractor Portal
 */
window.loadContractorPaymentsHistory = async function() {
  try {
    const tableBody = document.getElementById('contractor-payments-table-body');
    if (!tableBody) return;

    const res = await API.payments.getHistory();
    const payments = res.payments || [];

    const modePill = document.getElementById('contractor-payments-mode-pill');
    if (modePill && payments.length > 0) {
      const mode = payments[0].payment_mode;
      modePill.className = mode === 'live' ? 'badge-live-mode' : 'badge-test-mode';
      modePill.textContent = mode.toUpperCase() + ' MODE';
    }

    if (payments.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">No payment transactions recorded yet. Browse open tenders to pay tender fees or EMD.</td></tr>';
      return;
    }

    tableBody.innerHTML = payments.map(p => `
      <tr>
        <td><strong class="font-monospace text-primary">${p.receipt_no}</strong></td>
        <td>
          <strong>${p.tender_code}</strong>
          <div class="small text-muted text-truncate" style="max-width: 220px;">${p.tender_title}</div>
        </td>
        <td>
          <span class="badge ${p.payment_type === 'TENDER_FEE' ? 'bg-primary' : 'bg-info text-dark'}">
            ${p.payment_type === 'TENDER_FEE' ? 'Tender Fee' : 'EMD Deposit'}
          </span>
        </td>
        <td class="fw-bold text-dark">${UI.formatCurrency(p.amount_rupees)}</td>
        <td>
          <span class="${p.payment_mode === 'live' ? 'badge-live-mode' : 'badge-test-mode'}">
            ${p.payment_mode.toUpperCase()}
          </span>
        </td>
        <td>${UI.getStatusBadge(p.payment_status)}</td>
        <td class="small text-muted">${UI.formatDateTime(p.paid_at || p.created_at)}</td>
        <td>
          <div class="btn-group btn-group-sm">
            <button class="btn btn-outline-primary" onclick="viewPaymentDetailsById(${p.id})">
              <i class="bi bi-eye"></i> Receipt
            </button>
            ${p.payment_status === 'PAID' ? `
              <a href="${API.payments.getPdfUrl(p.id)}" target="_blank" class="btn btn-outline-danger" title="Download Official PDF Receipt">
                <i class="bi bi-file-earmark-pdf"></i> PDF
              </a>
            ` : ''}
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error loading contractor payments:', err);
  }
};

/**
 * Loads payment details by ID and opens receipt modal
 */
window.viewPaymentDetailsById = async function(paymentId) {
  try {
    const res = await API.payments.getById(paymentId);
    if (res.success && res.payment) {
      openPaymentReceiptModal(res.payment);
    }
  } catch (err) {
    UI.showToast('Could not load payment receipt: ' + err.message, 'error');
  }
};

/**
 * Admin: Loads payment metrics and filtered transactions list
 */
window.loadAdminPaymentManagement = async function() {
  try {
    // 1. Load Stats
    const statsRes = await API.payments.admin.getStats();
    const stats = statsRes.stats;

    const elTotal = document.getElementById('admin-payment-stat-total');
    const elPaidCount = document.getElementById('admin-payment-stat-paid-count');
    const elFeeTotal = document.getElementById('admin-payment-stat-fee-total');
    const elFeeCount = document.getElementById('admin-payment-stat-fee-count');
    const elEmdTotal = document.getElementById('admin-payment-stat-emd-total');
    const elEmdCount = document.getElementById('admin-payment-stat-emd-count');
    const elRevTotal = document.getElementById('admin-payment-stat-revenue-total');

    if (elTotal) elTotal.textContent = stats.totalPayments;
    if (elPaidCount) elPaidCount.textContent = `${stats.paidCount} Paid (${stats.failedCount} Failed)`;
    if (elFeeTotal) elFeeTotal.textContent = UI.formatCurrency(stats.tenderFeesCollectedRupees);
    if (elFeeCount) elFeeCount.textContent = `${stats.tenderFeesCount} Tender Fees Paid`;
    if (elEmdTotal) elEmdTotal.textContent = UI.formatCurrency(stats.emdHeldRupees);
    if (elEmdCount) elEmdCount.textContent = `${stats.emdCount} EMD Deposits Held`;
    if (elRevTotal) elRevTotal.textContent = UI.formatCurrency(stats.totalCollectedRupees);

    const modeSummary = document.getElementById('admin-payment-stat-mode-desc');
    const modePill = document.getElementById('admin-payments-mode-pill');
    if (modeSummary && stats.modeBreakdown) {
      modeSummary.textContent = `${stats.modeBreakdown.currentMode.toUpperCase()} Mode: ₹${stats.modeBreakdown.testVolumeRupees.toLocaleString('en-IN')} Test / ₹${stats.modeBreakdown.liveRevenueRupees.toLocaleString('en-IN')} Live`;
    }
    if (modePill && stats.modeBreakdown) {
      modePill.className = stats.modeBreakdown.currentMode === 'live' ? 'badge-live-mode' : 'badge-test-mode';
      modePill.textContent = stats.modeBreakdown.currentMode.toUpperCase() + ' MODE';
    }

    // 2. Load Filtered List
    await fetchAdminPaymentsList();
  } catch (err) {
    console.error('Error loading admin payment management:', err);
  }
};

/**
 * Admin: Fetches filtered list of payments with pagination
 */
window.fetchAdminPaymentsList = async function() {
  try {
    const tableBody = document.getElementById('admin-payments-table-body');
    if (!tableBody) return;

    const search = (document.getElementById('admin-payments-search')?.value || '').trim();
    const type = document.getElementById('admin-payments-filter-type')?.value || '';
    const status = document.getElementById('admin-payments-filter-status')?.value || '';
    const mode = document.getElementById('admin-payments-filter-mode')?.value || '';

    let query = `?page=${window.currentAdminPaymentPage || 1}&limit=15`;
    if (search) query += `&search=${encodeURIComponent(search)}`;
    if (type) query += `&paymentType=${encodeURIComponent(type)}`;
    if (status) query += `&status=${encodeURIComponent(status)}`;
    if (mode) query += `&mode=${encodeURIComponent(mode)}`;

    const res = await API.payments.admin.getPayments(query);
    const payments = res.payments || [];

    if (payments.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="10" class="text-center text-muted py-4">No payment records matching the selected filters.</td></tr>';
      return;
    }

    tableBody.innerHTML = payments.map(p => `
      <tr>
        <td><strong class="font-monospace text-primary">${p.receipt_no}</strong></td>
        <td>
          <strong>${p.company_name}</strong>
          <div class="small text-muted">${p.license_number || ''}</div>
        </td>
        <td>
          <code>${p.tender_code}</code>
          <div class="small text-muted text-truncate" style="max-width: 180px;">${p.tender_title}</div>
        </td>
        <td>
          <span class="badge ${p.payment_type === 'TENDER_FEE' ? 'bg-primary' : 'bg-info text-dark'}">
            ${p.payment_type === 'TENDER_FEE' ? 'Fee' : 'EMD'}
          </span>
        </td>
        <td class="fw-bold">${UI.formatCurrency(p.amount_rupees)}</td>
        <td>
          <span class="${p.payment_mode === 'live' ? 'badge-live-mode' : 'badge-test-mode'}">
            ${p.payment_mode.toUpperCase()}
          </span>
        </td>
        <td>${UI.getStatusBadge(p.payment_status)}</td>
        <td class="small font-monospace text-muted">${p.provider_payment_id || p.provider_order_id || '-'}</td>
        <td class="small text-muted">${UI.formatDateTime(p.paid_at || p.created_at)}</td>
        <td>
          <div class="btn-group btn-group-sm">
            <button class="btn btn-outline-primary" onclick="viewPaymentDetailsById(${p.id})">
              <i class="bi bi-eye"></i>
            </button>
            ${p.payment_status === 'PAID' ? `
              <a href="${API.payments.getPdfUrl(p.id)}" target="_blank" class="btn btn-outline-danger" title="Official PDF Receipt">
                <i class="bi bi-file-earmark-pdf"></i>
              </a>
              <button class="btn btn-outline-warning text-dark" title="Initiate Authorized Refund" onclick="adminInitiateRefund(${p.id}, '${p.receipt_no}', ${p.amount_rupees})">
                <i class="bi bi-arrow-return-left"></i>
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `).join('');

    // Pagination
    const paginationEl = document.getElementById('admin-payments-pagination');
    if (paginationEl && res.pagination) {
      paginationEl.innerHTML = `
        <div class="small text-muted">Showing page ${res.pagination.currentPage} of ${res.pagination.totalPages || 1} (${res.pagination.totalRecords} total records)</div>
        <div class="btn-group btn-group-sm">
          <button class="btn btn-outline-secondary" ${res.pagination.currentPage <= 1 ? 'disabled' : ''} onclick="changeAdminPaymentPage(${res.pagination.currentPage - 1})">Previous</button>
          <button class="btn btn-outline-secondary" ${res.pagination.currentPage >= res.pagination.totalPages ? 'disabled' : ''} onclick="changeAdminPaymentPage(${res.pagination.currentPage + 1})">Next</button>
        </div>
      `;
    }
  } catch (err) {
    console.error('Error fetching admin payments list:', err);
  }
};

window.applyAdminPaymentFilters = function() {
  window.currentAdminPaymentPage = 1;
  fetchAdminPaymentsList();
};

window.resetAdminPaymentFilters = function() {
  const elSearch = document.getElementById('admin-payments-search');
  const elType = document.getElementById('admin-payments-filter-type');
  const elStatus = document.getElementById('admin-payments-filter-status');
  const elMode = document.getElementById('admin-payments-filter-mode');

  if (elSearch) elSearch.value = '';
  if (elType) elType.value = '';
  if (elStatus) elStatus.value = '';
  if (elMode) elMode.value = '';

  window.currentAdminPaymentPage = 1;
  fetchAdminPaymentsList();
};

window.changeAdminPaymentPage = function(page) {
  window.currentAdminPaymentPage = page;
  fetchAdminPaymentsList();
};

window.adminInitiateRefund = async function(paymentId, receiptNo, amount) {
  const reason = prompt(
    `Authorized Refund Initiation\n\nConfirm refund for payment ${receiptNo} amounting to ${UI.formatCurrency(amount)}?\n\nEnter administrative reason for refund:`,
    'Official refund authorized by MIT Central Procurement Committee'
  );
  if (!reason) return;

  try {
    const res = await API.payments.admin.refund(paymentId, reason);
    UI.showToast(res.message, 'success');
    loadAdminPaymentManagement();
  } catch (err) {
    UI.showToast('Refund failed: ' + err.message, 'error');
  }
};

// ====================================================
// MODULE 1: CONTRACTOR PAYMENT MANAGEMENT (FRONTEND)
// ====================================================

window.contractorContractsCache = [];

/**
 * Loads awarded contracts and payment status for logged-in contractor
 */
window.loadContractorAwardedContracts = async function() {
  try {
    const tableBody = document.getElementById('contractor-contracts-table-body');
    if (!tableBody) return;

    const res = await API.contractorPayments.getMyPayments();
    const payments = res.payments || [];
    window.contractorContractsCache = payments;

    let totalApproved = 0;
    let totalPaid = 0;
    let totalRemaining = 0;

    payments.forEach(p => {
      totalApproved += parseFloat(p.approved_payable_amount) || 0;
      totalPaid += parseFloat(p.total_paid_amount) || 0;
      totalRemaining += parseFloat(p.remaining_payable_amount) || 0;
    });

    const elCount = document.getElementById('contractor-contracts-stat-count');
    const elAppr = document.getElementById('contractor-contracts-stat-approved');
    const elPaid = document.getElementById('contractor-contracts-stat-paid');
    const elRem = document.getElementById('contractor-contracts-stat-remaining');

    if (elCount) elCount.textContent = payments.length;
    if (elAppr) elAppr.textContent = UI.formatCurrency(totalApproved);
    if (elPaid) elPaid.textContent = UI.formatCurrency(totalPaid);
    if (elRem) elRem.textContent = UI.formatCurrency(totalRemaining);

    if (payments.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">No awarded contracts found for your account. Once your submitted bid is awarded, contracts will appear here for milestone submission and claim tracking.</td></tr>';
      return;
    }

    tableBody.innerHTML = payments.map(p => `
      <tr>
        <td>
          <strong class="text-primary font-monospace">${p.work_order_ref || 'WO-PENDING'}</strong>
          <div><code>${p.tender_code}</code> - <span class="text-dark fw-semibold text-truncate d-inline-block" style="max-width: 170px;" title="${p.tender_title}">${p.tender_title}</span></div>
        </td>
        <td class="fw-bold">${UI.formatCurrency(p.contract_amount)}</td>
        <td>${UI.getStatusBadge(p.work_status)}</td>
        <td>${UI.getStatusBadge(p.claim_status)}</td>
        <td class="fw-bold text-primary">${UI.formatCurrency(p.approved_payable_amount || 0)}</td>
        <td class="fw-bold text-success">${UI.formatCurrency(p.total_paid_amount || 0)}</td>
        <td class="fw-bold text-warning">${UI.formatCurrency(p.remaining_payable_amount || 0)}</td>
        <td>
          <div class="btn-group btn-group-sm">
            <button class="btn btn-outline-primary" onclick="viewContractorClaimDetails(${p.id})" title="View Details & Ledger">
              <i class="bi bi-eye"></i> Details
            </button>
            ${['work_in_progress', 'draft', 'rejected'].includes(p.work_status) || ['draft', 'rejected'].includes(p.claim_status) ? `
              <button class="btn btn-outline-success" onclick="openContractorClaimModal(${p.id})" title="Submit Work Completion / Claim">
                <i class="bi bi-file-earmark-check"></i> Submit Claim
              </button>
            ` : ''}
            ${parseFloat(p.total_paid_amount) > 0 ? `
              <a href="${API.contractorPayments.getPdfUrl(p.id)}" target="_blank" class="btn btn-outline-danger" title="Official Disbursement Voucher PDF">
                <i class="bi bi-file-earmark-pdf"></i> Voucher
              </a>
            ` : ''}
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error loading contractor awarded contracts:', err);
  }
};

/**
 * Opens Contractor Submit Claim modal
 */
window.openContractorClaimModal = function(selectedPaymentId) {
  const tenderSelect = document.getElementById('claim-tender-select');
  if (!tenderSelect) return;

  const claimable = (window.contractorContractsCache || []).filter(p =>
    ['work_in_progress', 'draft', 'rejected'].includes(p.work_status) || ['draft', 'rejected'].includes(p.claim_status)
  );

  if (claimable.length === 0 && !selectedPaymentId) {
    UI.showToast('No active awarded contracts currently require work completion or payment claims.', 'info');
    return;
  }

  tenderSelect.innerHTML = '<option value="">-- Select Awarded Tender --</option>' +
    (window.contractorContractsCache || []).map(p => `
      <option value="${p.id}" ${selectedPaymentId && selectedPaymentId == p.id ? 'selected' : ''}>
        ${p.work_order_ref || 'WO-#' + p.id} - ${p.tender_code} (${UI.formatCurrency(p.contract_amount)})
      </option>
    `).join('');

  if (selectedPaymentId) {
    onClaimTenderSelected(selectedPaymentId);
  } else {
    document.getElementById('claim-contract-details-box')?.classList.add('d-none');
    document.getElementById('claim-contract-payment-id').value = '';
  }

  bootstrap.Modal.getOrCreateInstance(document.getElementById('contractorClaimModal')).show();
};

/**
 * Handles contractor selecting a tender in claim modal
 */
window.onClaimTenderSelected = function(paymentId) {
  const detailsBox = document.getElementById('claim-contract-details-box');
  if (!paymentId) {
    if (detailsBox) detailsBox.classList.add('d-none');
    document.getElementById('claim-contract-payment-id').value = '';
    return;
  }

  const p = (window.contractorContractsCache || []).find(c => c.id == paymentId);
  if (!p) return;

  document.getElementById('claim-contract-payment-id').value = p.id;
  document.getElementById('claim-box-wo-ref').textContent = p.work_order_ref || 'WO-#' + p.id;
  document.getElementById('claim-box-contract-val').textContent = UI.formatCurrency(p.contract_amount);
  document.getElementById('claim-box-paid-val').textContent = UI.formatCurrency(p.total_paid_amount || 0);
  document.getElementById('claim-box-remaining-val').textContent = UI.formatCurrency(p.remaining_payable_amount > 0 ? p.remaining_payable_amount : p.contract_amount);

  const amountInput = document.getElementById('claim-amount');
  if (amountInput && (!amountInput.value || parseFloat(amountInput.value) <= 0)) {
    amountInput.value = parseFloat(p.remaining_payable_amount) > 0 ? p.remaining_payable_amount : p.contract_amount;
  }

  if (detailsBox) detailsBox.classList.remove('d-none');
};

/**
 * Submits work completion and invoice claim
 */
window.handleContractorClaimSubmit = async function(event) {
  event.preventDefault();
  const form = event.target;
  const paymentId = document.getElementById('claim-contract-payment-id').value;

  if (!paymentId) {
    UI.showToast('Please select an awarded contract first.', 'warning');
    return;
  }

  const submitBtn = document.getElementById('btn-submit-claim');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const formData = new FormData(form);
    const res = await API.contractorPayments.submitClaim(formData);
    UI.showToast(res.message || 'Work completion and payment claim submitted successfully.', 'success');
    bootstrap.Modal.getInstance(document.getElementById('contractorClaimModal'))?.hide();
    form.reset();
    await loadContractorAwardedContracts();
  } catch (err) {
    UI.showToast(err.message || 'Failed to submit payment claim.', 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
};

/**
 * Views full contractor claim details and disbursement ledger
 */
window.viewContractorClaimDetails = async function(paymentId) {
  try {
    const res = await API.contractorPayments.getById(paymentId);
    if (!res.success || !res.payment) return;
    const p = res.payment;
    const txs = res.transactions || [];
    const logs = res.auditLogs || [];

    const bodyEl = document.getElementById('claim-detail-modal-body');
    if (!bodyEl) return;

    bodyEl.innerHTML = `
      <div class="row g-3 mb-3">
        <div class="col-md-6">
          <div class="p-3 bg-light rounded-3 border">
            <small class="text-muted d-block">Work Order & Tender</small>
            <h5 class="fw-bold mb-1 text-primary font-monospace">${p.work_order_ref || 'WO-#' + p.id}</h5>
            <div class="small"><code>${p.tender_code}</code> - <strong>${p.tender_title}</strong></div>
            <div class="small text-muted mt-1">Awarded to: <strong>${p.contractor_company_name}</strong></div>
          </div>
        </div>
        <div class="col-md-6">
          <div class="p-3 bg-light rounded-3 border">
            <small class="text-muted d-block">Financial Reconciliation</small>
            <div class="d-flex justify-content-between small mb-1">
              <span>Agreed Contract Amount:</span>
              <strong class="text-dark">${UI.formatCurrency(p.contract_amount)}</strong>
            </div>
            <div class="d-flex justify-content-between small mb-1">
              <span>Approved Payable:</span>
              <strong class="text-primary">${UI.formatCurrency(p.approved_payable_amount || 0)}</strong>
            </div>
            <div class="d-flex justify-content-between small mb-1">
              <span>Disbursed to Date:</span>
              <strong class="text-success">${UI.formatCurrency(p.total_paid_amount || 0)}</strong>
            </div>
            <div class="d-flex justify-content-between small border-top pt-1">
              <span>Remaining Liability:</span>
              <strong class="text-warning">${UI.formatCurrency(p.remaining_payable_amount || 0)}</strong>
            </div>
          </div>
        </div>
      </div>

      <!-- Current Workflow Status -->
      <div class="p-3 bg-light rounded-3 border mb-3">
        <div class="row g-2 align-items-center">
          <div class="col-md-6">
            <span class="text-muted small">Work Progress Status:</span>
            <div class="mt-1">${UI.getStatusBadge(p.work_status)}</div>
          </div>
          <div class="col-md-6">
            <span class="text-muted small">Payment Claim Status:</span>
            <div class="mt-1">${UI.getStatusBadge(p.claim_status)}</div>
          </div>
        </div>
        ${p.rejection_reason ? `
          <div class="alert alert-danger py-2 px-3 small rounded-3 mt-2 mb-0">
            <strong>Rejection / Dispute Reason:</strong> ${p.rejection_reason}
          </div>
        ` : ''}
      </div>

      <!-- Milestone Claims & Evidence -->
      <div class="card border mb-3">
        <div class="card-header bg-light py-2">
          <h6 class="fw-bold mb-0 small"><i class="bi bi-file-earmark-text text-primary me-1"></i>Work Completion & Claim Submission</h6>
        </div>
        <div class="card-body small">
          <div class="row g-2">
            <div class="col-md-4"><strong>Claimed Amount:</strong> ${p.claimed_amount ? UI.formatCurrency(p.claimed_amount) : '-'}</div>
            <div class="col-md-4"><strong>Completion Date:</strong> ${p.completion_date ? UI.formatDate(p.completion_date) : '-'}</div>
            <div class="col-md-4"><strong>Claim Request Date:</strong> ${p.claim_submitted_at ? UI.formatDate(p.claim_submitted_at) : '-'}</div>
            <div class="col-md-4"><strong>Invoice Ref:</strong> ${p.invoice_ref || '-'}</div>
            <div class="col-md-4"><strong>Invoice Date:</strong> ${p.invoice_date ? UI.formatDate(p.invoice_date) : '-'}</div>
            <div class="col-md-4">
              <strong>Uploaded Documents:</strong><br>
              ${p.completion_evidence_doc ? `<a href="${p.completion_evidence_doc}" target="_blank" class="badge bg-primary text-decoration-none me-1"><i class="bi bi-paperclip"></i> Evidence Doc</a>` : ''}
              ${p.invoice_doc ? `<a href="${p.invoice_doc}" target="_blank" class="badge bg-secondary text-decoration-none"><i class="bi bi-receipt"></i> Commercial Invoice</a>` : ''}
              ${!p.completion_evidence_doc && !p.invoice_doc ? '-' : ''}
            </div>
            ${p.claim_remarks ? `<div class="col-12 mt-2"><strong>Contractor Remarks:</strong> ${p.claim_remarks}</div>` : ''}
          </div>
        </div>
      </div>

      <!-- Inspection & Statutory Adjustments -->
      <div class="card border mb-3">
        <div class="card-header bg-light py-2">
          <h6 class="fw-bold mb-0 small"><i class="bi bi-clipboard-check text-success me-1"></i>Inspection & Institutional Approval Breakdown</h6>
        </div>
        <div class="card-body small">
          <div class="row g-2">
            <div class="col-md-4"><strong>Inspection Cert:</strong> ${p.inspection_certificate_ref || '-'}</div>
            <div class="col-md-4"><strong>Inspected By:</strong> ${p.inspector_name || '-'}</div>
            <div class="col-md-4"><strong>Inspected Date:</strong> ${p.inspected_at ? UI.formatDate(p.inspected_at) : '-'}</div>
            <div class="col-md-4"><strong>Approved By:</strong> ${p.approved_by_name || '-'}</div>
            <div class="col-md-4"><strong>Approved Date:</strong> ${p.approved_at ? UI.formatDate(p.approved_at) : '-'}</div>
            <div class="col-md-4"><strong>Deductions / Penalties:</strong> ${UI.formatCurrency(p.deductions_amount || 0)}</div>
            <div class="col-md-4"><strong>Statutory Taxes (TDS/GST):</strong> ${UI.formatCurrency(p.taxes_amount || 0)}</div>
            <div class="col-md-4"><strong>Security Retention:</strong> ${UI.formatCurrency(p.retention_amount || 0)}</div>
            <div class="col-md-4"><strong>Net Payable Sanctioned:</strong> <span class="text-primary fw-bold">${UI.formatCurrency(p.approved_payable_amount || 0)}</span></div>
            ${p.approval_remarks ? `<div class="col-12 mt-2"><strong>Approval Remarks:</strong> ${p.approval_remarks}</div>` : ''}
          </div>
        </div>
      </div>

      <!-- Bank Disbursement Ledger -->
      <div class="card border mb-3">
        <div class="card-header bg-light py-2 d-flex justify-content-between align-items-center">
          <h6 class="fw-bold mb-0 small"><i class="bi bi-bank text-dark me-1"></i>External Bank Disbursement Records (NEFT/RTGS/Cheque)</h6>
          <span class="badge bg-success">${txs.length} Disbursements</span>
        </div>
        <div class="table-responsive">
          <table class="table table-sm table-hover align-middle mb-0" style="font-size: 0.85rem;">
            <thead class="table-light">
              <tr>
                <th>Voucher #</th>
                <th>Method</th>
                <th>Bank UTR / Ref</th>
                <th>Amount</th>
                <th>Disbursed Date</th>
                <th>Issuing Bank</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${txs.length === 0 ? '<tr><td colspan="7" class="text-center text-muted py-3">No disbursement transactions recorded yet.</td></tr>' :
                txs.map(t => `
                  <tr>
                    <td><strong class="font-monospace text-primary">${t.voucher_no}</strong></td>
                    <td><span class="badge bg-light text-dark border">${(t.payment_method || 'NEFT').toUpperCase()}</span></td>
                    <td><code>${t.transaction_reference}</code></td>
                    <td class="fw-bold text-success">${UI.formatCurrency(t.payment_amount)}</td>
                    <td>${UI.formatDate(t.payment_date)}</td>
                    <td>${t.issuing_bank || '-'}</td>
                    <td><span class="badge bg-success bg-opacity-10 text-success border border-success">CONFIRMED</span></td>
                  </tr>
                `).join('')
              }
            </tbody>
          </table>
        </div>
      </div>

      <!-- Audit History -->
      <div class="card border">
        <div class="card-header bg-light py-2">
          <h6 class="fw-bold mb-0 small"><i class="bi bi-clock-history text-secondary me-1"></i>Milestone Audit Trail</h6>
        </div>
        <div class="table-responsive" style="max-height: 160px; overflow-y: auto;">
          <table class="table table-sm align-middle mb-0" style="font-size: 0.8rem;">
            <tbody>
              ${logs.length === 0 ? '<tr><td class="text-muted text-center py-2">No audit records logged.</td></tr>' :
                logs.map(l => `
                  <tr>
                    <td width="130"><span class="badge bg-light text-dark font-monospace border">${l.action}</span></td>
                    <td>${l.description}</td>
                    <td width="120" class="text-muted">${l.performed_by_name || 'System'}</td>
                    <td width="140" class="text-muted">${UI.formatDateTime(l.created_at)}</td>
                  </tr>
                `).join('')
              }
            </tbody>
          </table>
        </div>
      </div>
    `;

    const dlBtn = document.getElementById('btn-modal-voucher-download');
    if (dlBtn) {
      if (parseFloat(p.total_paid_amount) > 0) {
        dlBtn.classList.remove('d-none');
        dlBtn.onclick = () => window.open(API.contractorPayments.getPdfUrl(p.id), '_blank');
      } else {
        dlBtn.classList.add('d-none');
      }
    }

    bootstrap.Modal.getOrCreateInstance(document.getElementById('contractorClaimDetailModal')).show();
  } catch (err) {
    UI.showToast('Could not load contract claim details: ' + err.message, 'error');
  }
};

// ====================================================
// MODULE 2: CONTRACTOR EMD REFUND STATUS (FRONTEND)
// ====================================================

/**
 * Loads EMD refund records for logged-in contractor
 */
window.loadContractorEmdRefunds = async function() {
  try {
    const tableBody = document.getElementById('contractor-emd-refunds-table-body');
    if (!tableBody) return;

    const res = await API.emdRefunds.getMyRefunds();
    const refunds = res.refunds || [];

    if (refunds.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">No EMD security deposit return records found. Deposits for closed or cancelled tenders will appear here after committee assessment.</td></tr>';
      return;
    }

    tableBody.innerHTML = refunds.map(r => `
      <tr>
        <td><strong class="font-monospace text-primary">${r.original_receipt_no || 'EMD-#' + r.id}</strong></td>
        <td>
          <code>${r.tender_code}</code>
          <div class="small text-muted text-truncate" style="max-width: 180px;">${r.tender_title}</div>
        </td>
        <td class="fw-bold">${UI.formatCurrency(r.original_emd_amount)}</td>
        <td>${UI.getStatusBadge(r.refund_status)}</td>
        <td>
          <span class="small text-muted">${r.eligibility_reason || r.eligibility_determination || 'Awaiting Assessment'}</span>
          ${r.forfeiture_reason ? `<div class="badge bg-danger bg-opacity-10 text-danger border border-danger mt-1">Forfeiture: ${r.forfeiture_reason}</div>` : ''}
        </td>
        <td>
          ${r.refund_status === 'COMPLETED' ? `
            <span class="badge bg-light text-dark font-monospace border">${r.execution_type === 'GATEWAY_API' ? 'Razorpay API' : 'Bank Transfer'}</span>
            <div class="small font-monospace text-success">${r.gateway_refund_id || r.transaction_reference || 'UTR Confirmed'}</div>
          ` : '<span class="text-muted small">Pending Execution</span>'}
        </td>
        <td class="small text-muted">${r.refund_completed_at ? UI.formatDate(r.refund_completed_at) : (r.approved_at ? UI.formatDate(r.approved_at) : '-')}</td>
        <td>
          ${['COMPLETED', 'APPROVED', 'FORFEITED'].includes(r.refund_status) ? `
            <a href="${API.emdRefunds.getAdvicePdfUrl(r.id)}" target="_blank" class="btn btn-sm btn-outline-danger" title="Download Official EMD Advice Slip PDF">
              <i class="bi bi-file-earmark-pdf"></i> Advice
            </a>
          ` : '<span class="text-muted small">-</span>'}
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Error loading contractor EMD refunds:', err);
  }
};

// ====================================================
// MODULE 1: ADMIN CONTRACTOR PAYMENT DESK (FRONTEND)
// ====================================================

window.adminContractsCache = [];

/**
 * Loads Admin Contractor Payment Management Desk
 */
window.loadAdminContractorPaymentDesk = async function() {
  try {
    const res = await API.contractorPayments.admin.getAll();
    const payments = res.payments || [];
    window.adminContractsCache = payments;

    let totalApproved = 0;
    let totalDisbursed = 0;
    let totalRemaining = 0;
    let pendingClaims = 0;
    let pendingInspections = 0;
    let fullySettled = 0;

    const inspectionsList = [];
    const claimsList = [];
    const disburseList = [];

    payments.forEach(p => {
      totalApproved += parseFloat(p.approved_payable_amount) || 0;
      totalDisbursed += parseFloat(p.total_paid_amount) || 0;
      totalRemaining += parseFloat(p.remaining_payable_amount) || 0;

      if (['completion_submitted', 'evidence_submitted', 'inspection_pending'].includes(p.work_status)) {
        pendingInspections++;
        inspectionsList.push(p);
      }

      if (['claim_submitted', 'approval_pending'].includes(p.claim_status)) {
        pendingClaims++;
        claimsList.push(p);
      }

      if (p.claim_status === 'approved' || (p.claim_status === 'partially_paid' && parseFloat(p.remaining_payable_amount) > 0)) {
        disburseList.push(p);
      }

      if (p.claim_status === 'fully_paid') {
        fullySettled++;
      }
    });

    // KPI Cards
    const elAppr = document.getElementById('admin-cp-stat-approved');
    const elCount = document.getElementById('admin-cp-stat-contracts-count');
    const elDisb = document.getElementById('admin-cp-stat-disbursed');
    const elPaidCount = document.getElementById('admin-cp-stat-paid-count');
    const elRem = document.getElementById('admin-cp-stat-remaining');
    const elPendClaims = document.getElementById('admin-cp-stat-pending-claims');
    const elPendInsp = document.getElementById('admin-cp-stat-pending-inspections');

    if (elAppr) elAppr.textContent = UI.formatCurrency(totalApproved);
    if (elCount) elCount.textContent = `${payments.length} Active Contracts`;
    if (elDisb) elDisb.textContent = UI.formatCurrency(totalDisbursed);
    if (elPaidCount) elPaidCount.textContent = `${fullySettled} Fully Settled`;
    if (elRem) elRem.textContent = UI.formatCurrency(totalRemaining);
    if (elPendClaims) elPendClaims.textContent = pendingClaims;
    if (elPendInsp) elPendInsp.textContent = `${pendingInspections} Inspections pending`;

    // Badges on tabs
    const bInsp = document.getElementById('admin-cp-badge-inspections');
    const bClaims = document.getElementById('admin-cp-badge-claims');
    const bDisb = document.getElementById('admin-cp-badge-disburse');

    if (bInsp) bInsp.textContent = pendingInspections;
    if (bClaims) bClaims.textContent = pendingClaims;
    if (bDisb) bDisb.textContent = disburseList.length;

    // Render Tab 1: Inspections
    const inspTable = document.getElementById('admin-pending-inspections-table-body');
    if (inspTable) {
      if (inspectionsList.length === 0) {
        inspTable.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">No contractor work completions pending inspection.</td></tr>';
      } else {
        inspTable.innerHTML = inspectionsList.map(p => `
          <tr>
            <td><strong class="font-monospace text-primary">${p.work_order_ref || 'WO-#' + p.id}</strong></td>
            <td><code>${p.tender_code}</code><div class="small text-muted text-truncate" style="max-width: 170px;">${p.tender_title}</div></td>
            <td><strong>${p.contractor_company_name}</strong></td>
            <td>${p.completion_date ? UI.formatDate(p.completion_date) : '-'}</td>
            <td class="fw-bold">${UI.formatCurrency(p.claimed_amount || p.contract_amount)}</td>
            <td>
              ${p.completion_evidence_doc ? `<a href="${p.completion_evidence_doc}" target="_blank" class="btn btn-xs btn-outline-primary"><i class="bi bi-paperclip"></i> Evidence</a>` : '<span class="text-muted small">None</span>'}
            </td>
            <td>
              <button class="btn btn-sm btn-primary" onclick="openInspectWorkModal(${p.id})">
                <i class="bi bi-clipboard-check me-1"></i> Inspect Work
              </button>
            </td>
          </tr>
        `).join('');
      }
    }

    // Render Tab 2: Claims
    const claimsTable = document.getElementById('admin-pending-claims-table-body');
    if (claimsTable) {
      if (claimsList.length === 0) {
        claimsTable.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">No contractor claims awaiting administrative sanction.</td></tr>';
      } else {
        claimsTable.innerHTML = claimsList.map(p => `
          <tr>
            <td><strong class="font-monospace text-primary">${p.work_order_ref || 'WO-#' + p.id}</strong></td>
            <td><code>${p.tender_code}</code><div class="small text-muted text-truncate" style="max-width: 170px;">${p.tender_title}</div></td>
            <td><strong>${p.contractor_company_name}</strong></td>
            <td>
              <strong>${p.invoice_ref || '-'}</strong>
              ${p.invoice_doc ? `<div><a href="${p.invoice_doc}" target="_blank" class="small text-primary"><i class="bi bi-file-earmark-pdf"></i> View Invoice</a></div>` : ''}
            </td>
            <td class="fw-bold text-success">${UI.formatCurrency(p.claimed_amount || p.contract_amount)}</td>
            <td class="text-muted">${UI.formatCurrency(p.contract_amount)}</td>
            <td>
              <button class="btn btn-sm btn-success" onclick="openApproveClaimModal(${p.id})">
                <i class="bi bi-calculator me-1"></i> Review & Approve
              </button>
            </td>
          </tr>
        `).join('');
      }
    }

    // Render Tab 3: Disbursements
    const disburseTable = document.getElementById('admin-approved-disbursements-table-body');
    if (disburseTable) {
      if (disburseList.length === 0) {
        disburseTable.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">No approved claims currently awaiting banking disbursement.</td></tr>';
      } else {
        disburseTable.innerHTML = disburseList.map(p => `
          <tr>
            <td><strong class="font-monospace text-primary">${p.work_order_ref || 'WO-#' + p.id}</strong></td>
            <td><code>${p.tender_code}</code><div class="small text-muted text-truncate" style="max-width: 170px;">${p.tender_title}</div></td>
            <td><strong>${p.contractor_company_name}</strong></td>
            <td class="fw-bold text-primary">${UI.formatCurrency(p.approved_payable_amount)}</td>
            <td class="fw-bold text-success">${UI.formatCurrency(p.total_paid_amount || 0)}</td>
            <td class="fw-bold text-warning">${UI.formatCurrency(p.remaining_payable_amount)}</td>
            <td>
              <button class="btn btn-sm btn-outline-success" onclick="openRecordPaymentModal(${p.id})">
                <i class="bi bi-bank me-1"></i> Disburse Payment
              </button>
            </td>
          </tr>
        `).join('');
      }
    }

    // Tab 4: All Contracts
    loadAdminAllContracts();
  } catch (err) {
    console.error('Error loading admin contractor payment desk:', err);
  }
};

/**
 * Loads all contracts table with search & filter in Admin desk
 */
window.loadAdminAllContracts = function() {
  const table = document.getElementById('admin-contractor-payments-all-table-body');
  if (!table) return;

  const search = (document.getElementById('admin-cp-search-input')?.value || '').toLowerCase();
  const statusFilter = document.getElementById('admin-cp-filter-status')?.value || '';

  let filtered = window.adminContractsCache || [];

  if (search) {
    filtered = filtered.filter(p =>
      (p.work_order_ref || '').toLowerCase().includes(search) ||
      (p.tender_code || '').toLowerCase().includes(search) ||
      (p.tender_title || '').toLowerCase().includes(search) ||
      (p.contractor_company_name || '').toLowerCase().includes(search)
    );
  }

  if (statusFilter) {
    filtered = filtered.filter(p => p.claim_status === statusFilter);
  }

  if (filtered.length === 0) {
    table.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">No contractor payment records match the selected criteria.</td></tr>';
    return;
  }

  table.innerHTML = filtered.map(p => `
    <tr>
      <td><strong class="font-monospace text-primary">${p.work_order_ref || 'WO-#' + p.id}</strong></td>
      <td><code>${p.tender_code}</code><div class="small text-muted text-truncate" style="max-width: 170px;">${p.tender_title}</div></td>
      <td><strong>${p.contractor_company_name}</strong></td>
      <td class="fw-bold">${UI.formatCurrency(p.contract_amount)}</td>
      <td>${UI.getStatusBadge(p.work_status)}</td>
      <td>${UI.getStatusBadge(p.claim_status)}</td>
      <td>
        <div><strong class="text-success">${UI.formatCurrency(p.total_paid_amount || 0)}</strong> / <span class="text-primary">${UI.formatCurrency(p.approved_payable_amount || 0)}</span></div>
        <small class="text-muted">Bal: ${UI.formatCurrency(p.remaining_payable_amount || 0)}</small>
      </td>
      <td>
        <div class="btn-group btn-group-sm">
          <button class="btn btn-outline-primary" onclick="viewContractorClaimDetails(${p.id})" title="View Details">
            <i class="bi bi-eye"></i>
          </button>
          ${parseFloat(p.total_paid_amount) > 0 ? `
            <a href="${API.contractorPayments.getPdfUrl(p.id)}" target="_blank" class="btn btn-outline-danger" title="Download Voucher PDF">
              <i class="bi bi-file-earmark-pdf"></i>
            </a>
          ` : ''}
          ${['approved', 'partially_paid'].includes(p.claim_status) && parseFloat(p.remaining_payable_amount) > 0 ? `
            <button class="btn btn-outline-success" onclick="openRecordPaymentModal(${p.id})" title="Disburse Payment">
              <i class="bi bi-bank"></i>
            </button>
          ` : ''}
        </div>
      </td>
    </tr>
  `).join('');
};

/**
 * Opens Admin Inspect Work Modal
 */
window.openInspectWorkModal = function(paymentId) {
  const p = (window.adminContractsCache || []).find(c => c.id == paymentId);
  if (!p) return;

  document.getElementById('inspect-payment-id').value = p.id;
  document.getElementById('inspect-contractor-name').textContent = p.contractor_company_name;
  document.getElementById('inspect-tender-code').textContent = `${p.tender_code} - ${p.tender_title}`;
  document.getElementById('inspect-wo-ref').textContent = p.work_order_ref || 'WO-#' + p.id;

  const evEl = document.getElementById('inspect-evidence-link');
  if (evEl) {
    evEl.innerHTML = p.completion_evidence_doc ?
      `<a href="${p.completion_evidence_doc}" target="_blank" class="badge bg-primary text-decoration-none"><i class="bi bi-paperclip"></i> View Attached Work Evidence</a>` :
      '<span class="text-muted">No evidence document attached</span>';
  }

  document.getElementById('inspect-notes').value = '';
  document.getElementById('inspect-approve').checked = true;

  bootstrap.Modal.getOrCreateInstance(document.getElementById('adminInspectWorkModal')).show();
};

/**
 * Handles submission of work inspection
 */
window.handleAdminInspectSubmit = async function(event) {
  event.preventDefault();
  const paymentId = document.getElementById('inspect-payment-id').value;
  const decision = document.querySelector('input[name="inspect_decision"]:checked')?.value || 'approve';
  const notes = document.getElementById('inspect-notes').value.trim();

  const btn = document.getElementById('btn-submit-inspect');
  if (btn) btn.disabled = true;

  try {
    const res = await API.contractorPayments.admin.inspectWork(paymentId, {
      decision,
      inspection_certificate_ref: notes,
      remarks: notes
    });
    UI.showToast(res.message, 'success');
    bootstrap.Modal.getInstance(document.getElementById('adminInspectWorkModal'))?.hide();
    await loadAdminContractorPaymentDesk();
  } catch (err) {
    UI.showToast(err.message || 'Inspection recording failed.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
};

/**
 * Opens Admin Approve Claim Modal
 */
window.openApproveClaimModal = function(paymentId) {
  const p = (window.adminContractsCache || []).find(c => c.id == paymentId);
  if (!p) return;

  document.getElementById('approve-claim-payment-id').value = p.id;
  document.getElementById('approve-claim-contractor').textContent = p.contractor_company_name;
  document.getElementById('approve-claim-tender').textContent = `${p.tender_code} - ${p.tender_title}`;
  document.getElementById('approve-claim-invoice-ref').textContent = p.invoice_ref || '-';

  const invLink = document.getElementById('approve-claim-invoice-link');
  if (invLink) {
    invLink.innerHTML = p.invoice_doc ?
      `<a href="${p.invoice_doc}" target="_blank" class="badge bg-secondary text-decoration-none"><i class="bi bi-receipt"></i> Stamped Invoice</a>` :
      '<span class="text-muted">None attached</span>';
  }

  document.getElementById('approve-claim-contract-val').textContent = UI.formatCurrency(p.contract_amount);
  document.getElementById('approve-claim-claimed-val').textContent = UI.formatCurrency(p.claimed_amount || p.contract_amount);

  document.getElementById('approve-deductions').value = '0';
  document.getElementById('approve-taxes').value = '0';
  document.getElementById('approve-retention').value = '0';
  document.getElementById('approve-claim-notes').value = '';

  recalcApprovedPayable();

  bootstrap.Modal.getOrCreateInstance(document.getElementById('adminApproveClaimModal')).show();
};

/**
 * Recalculates net approved payable in claim modal
 */
window.recalcApprovedPayable = function() {
  const paymentId = document.getElementById('approve-claim-payment-id').value;
  const p = (window.adminContractsCache || []).find(c => c.id == paymentId);
  if (!p) return;

  const base = parseFloat(p.claimed_amount || p.contract_amount) || 0;
  const deductions = parseFloat(document.getElementById('approve-deductions')?.value) || 0;
  const taxes = parseFloat(document.getElementById('approve-taxes')?.value) || 0;
  const retention = parseFloat(document.getElementById('approve-retention')?.value) || 0;

  const net = Math.max(0, base - deductions - taxes - retention);

  document.getElementById('approve-net-payable-display').textContent = UI.formatCurrency(net);
  document.getElementById('approve-net-payable-input').value = net.toFixed(2);
};

/**
 * Handles Admin Claim Approval submission
 */
window.handleAdminApproveClaimSubmit = async function(event) {
  event.preventDefault();
  const paymentId = document.getElementById('approve-claim-payment-id').value;
  const approvedAmount = parseFloat(document.getElementById('approve-net-payable-input').value);
  const deductions = parseFloat(document.getElementById('approve-deductions').value) || 0;
  const taxes = parseFloat(document.getElementById('approve-taxes').value) || 0;
  const retention = parseFloat(document.getElementById('approve-retention').value) || 0;
  const remarks = document.getElementById('approve-claim-notes').value.trim();

  const btn = document.getElementById('btn-confirm-approve-claim');
  if (btn) btn.disabled = true;

  try {
    const res = await API.contractorPayments.admin.approveClaim(paymentId, {
      approved_payable_amount: approvedAmount,
      deductions_amount: deductions,
      taxes_amount: taxes,
      retention_amount: retention,
      remarks
    });
    UI.showToast(res.message, 'success');
    bootstrap.Modal.getInstance(document.getElementById('adminApproveClaimModal'))?.hide();
    await loadAdminContractorPaymentDesk();
  } catch (err) {
    UI.showToast(err.message || 'Claim approval failed.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
};

/**
 * Rejects contractor payment claim with mandatory reason
 */
window.promptRejectClaim = async function() {
  const paymentId = document.getElementById('approve-claim-payment-id').value;
  const reason = prompt('Enter official institutional rejection reason for this payment claim:');
  if (!reason || !reason.trim()) {
    alert('Rejection reason is mandatory.');
    return;
  }

  try {
    const res = await API.contractorPayments.admin.rejectClaim(paymentId, reason.trim());
    UI.showToast(res.message, 'success');
    bootstrap.Modal.getInstance(document.getElementById('adminApproveClaimModal'))?.hide();
    await loadAdminContractorPaymentDesk();
  } catch (err) {
    UI.showToast(err.message || 'Claim rejection failed.', 'error');
  }
};

/**
 * Opens Admin Record Payment Disbursement Modal
 */
window.openRecordPaymentModal = function(paymentId) {
  const p = (window.adminContractsCache || []).find(c => c.id == paymentId);
  if (!p) return;

  document.getElementById('record-pmt-payment-id').value = p.id;
  document.getElementById('record-pmt-contractor').textContent = p.contractor_company_name;
  document.getElementById('record-pmt-tender').textContent = `${p.tender_code} - ${p.tender_title}`;
  document.getElementById('record-pmt-approved-val').textContent = UI.formatCurrency(p.approved_payable_amount);
  document.getElementById('record-pmt-paid-val').textContent = UI.formatCurrency(p.total_paid_amount || 0);
  document.getElementById('record-pmt-remaining-val').textContent = UI.formatCurrency(p.remaining_payable_amount);

  const amountInput = document.getElementById('record-pmt-amount');
  if (amountInput) {
    amountInput.value = p.remaining_payable_amount;
    amountInput.max = p.remaining_payable_amount;
  }

  document.getElementById('record-pmt-ref').value = '';
  document.getElementById('record-pmt-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('record-pmt-bank').value = 'State Bank of India - MIT Branch';
  document.getElementById('record-pmt-notes').value = '';

  bootstrap.Modal.getOrCreateInstance(document.getElementById('adminRecordPaymentModal')).show();
};

/**
 * Handles recording external bank payment disbursement
 */
window.handleAdminRecordPaymentSubmit = async function(event) {
  event.preventDefault();
  const paymentId = document.getElementById('record-pmt-payment-id').value;
  const form = event.target;

  const btn = document.getElementById('btn-submit-record-payment');
  if (btn) btn.disabled = true;

  try {
    const formData = new FormData();
    formData.append('payment_amount', document.getElementById('record-pmt-amount').value);
    formData.append('payment_method', document.getElementById('record-pmt-method').value);
    formData.append('transaction_reference', document.getElementById('record-pmt-ref').value);
    formData.append('payment_date', document.getElementById('record-pmt-date').value);
    formData.append('issuing_bank', document.getElementById('record-pmt-bank').value);
    formData.append('vendor_account_last4', document.getElementById('record-pmt-last4').value);
    formData.append('remarks', document.getElementById('record-pmt-notes').value);

    const proofFile = document.getElementById('record-pmt-proof')?.files[0];
    if (proofFile) formData.append('proof', proofFile);

    const res = await API.contractorPayments.admin.recordPayment(paymentId, formData);
    UI.showToast(res.message, 'success');
    bootstrap.Modal.getInstance(document.getElementById('adminRecordPaymentModal'))?.hide();
    form.reset();
    await loadAdminContractorPaymentDesk();
  } catch (err) {
    UI.showToast(err.message || 'Payment recording failed.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
};

// ====================================================
// MODULE 2: ADMIN EMD REFUND DESK (FRONTEND)
// ====================================================

window.adminEmdCache = [];

/**
 * Loads Admin EMD Refund Desk
 */
window.loadAdminEmdRefundDesk = async function() {
  try {
    const res = await API.emdRefunds.admin.getAll();
    const refunds = res.refunds || [];
    window.adminEmdCache = refunds;

    let totalCollected = 0;
    let totalEligible = 0;
    let totalCompleted = 0;
    let totalForfeited = 0;

    let eligibleCount = 0;
    let completedCount = 0;
    let forfeitedCount = 0;

    const reviewList = [];
    const executeList = [];

    refunds.forEach(r => {
      totalCollected += parseFloat(r.original_emd_amount) || 0;

      if (['ELIGIBLE', 'PENDING_REVIEW'].includes(r.refund_status)) {
        reviewList.push(r);
        totalEligible += parseFloat(r.refund_eligible_amount || r.original_emd_amount) || 0;
        eligibleCount++;
      } else if (r.refund_status === 'APPROVED') {
        executeList.push(r);
        totalEligible += parseFloat(r.refund_amount) || 0;
        eligibleCount++;
      } else if (r.refund_status === 'COMPLETED') {
        totalCompleted += parseFloat(r.refund_amount) || 0;
        completedCount++;
      } else if (r.refund_status === 'FORFEITED') {
        totalForfeited += parseFloat(r.original_emd_amount) || 0;
        forfeitedCount++;
      }
    });

    // KPI Cards
    const elColl = document.getElementById('admin-emd-stat-collected');
    const elCollCount = document.getElementById('admin-emd-stat-collected-count');
    const elElig = document.getElementById('admin-emd-stat-eligible');
    const elEligCount = document.getElementById('admin-emd-stat-eligible-count');
    const elComp = document.getElementById('admin-emd-stat-completed');
    const elCompCount = document.getElementById('admin-emd-stat-completed-count');
    const elForf = document.getElementById('admin-emd-stat-forfeited');
    const elForfCount = document.getElementById('admin-emd-stat-forfeited-count');

    if (elColl) elColl.textContent = UI.formatCurrency(totalCollected);
    if (elCollCount) elCollCount.textContent = `${refunds.length} Total Deposits`;
    if (elElig) elElig.textContent = UI.formatCurrency(totalEligible);
    if (elEligCount) elEligCount.textContent = `${eligibleCount} Bidders Eligible`;
    if (elComp) elComp.textContent = UI.formatCurrency(totalCompleted);
    if (elCompCount) elCompCount.textContent = `${completedCount} Successfully Returned`;
    if (elForf) elForf.textContent = UI.formatCurrency(totalForfeited);
    if (elForfCount) elForfCount.textContent = `${forfeitedCount} Forfeited to MIT`;

    // Badges
    const bRev = document.getElementById('admin-emd-badge-review');
    const bExec = document.getElementById('admin-emd-badge-execute');
    if (bRev) bRev.textContent = reviewList.length;
    if (bExec) bExec.textContent = executeList.length;

    // Tab 1: Pending Review
    const revTable = document.getElementById('admin-pending-refunds-table-body');
    if (revTable) {
      if (reviewList.length === 0) {
        revTable.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">No EMD deposits currently pending review. Click "Assess Tender EMD Eligibility" above to evaluate closed tenders.</td></tr>';
      } else {
        revTable.innerHTML = reviewList.map(r => `
          <tr>
            <td><strong class="font-monospace text-primary">${r.original_receipt_no || 'EMD-#' + r.id}</strong></td>
            <td><code>${r.tender_code}</code><div class="small text-muted text-truncate" style="max-width: 170px;">${r.tender_title}</div></td>
            <td><strong>${r.company_name}</strong></td>
            <td class="fw-bold">${UI.formatCurrency(r.original_emd_amount)}</td>
            <td><span class="badge bg-info text-dark">${r.eligibility_determination || 'Awaiting Review'}</span></td>
            <td class="small text-muted">${r.eligibility_assessed_at ? UI.formatDate(r.eligibility_assessed_at) : '-'}</td>
            <td>
              <button class="btn btn-sm btn-primary" onclick="openReviewRefundModal(${r.id})">
                <i class="bi bi-arrow-return-left me-1"></i> Review Request
              </button>
            </td>
          </tr>
        `).join('');
      }
    }

    // Tab 2: Awaiting Execution
    const execTable = document.getElementById('admin-approved-refunds-table-body');
    if (execTable) {
      if (executeList.length === 0) {
        execTable.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">No approved refunds awaiting banking execution.</td></tr>';
      } else {
        execTable.innerHTML = executeList.map(r => `
          <tr>
            <td><strong class="font-monospace text-primary">${r.original_receipt_no || 'EMD-#' + r.id}</strong></td>
            <td><code>${r.tender_code}</code><div class="small text-muted text-truncate" style="max-width: 170px;">${r.tender_title}</div></td>
            <td><strong>${r.company_name}</strong></td>
            <td class="fw-bold text-success">${UI.formatCurrency(r.refund_amount)}</td>
            <td><code>${r.provider_payment_id || 'EXTERNAL'}</code></td>
            <td class="small text-muted">${r.approved_at ? UI.formatDate(r.approved_at) : '-'}</td>
            <td>
              <button class="btn btn-sm btn-success" onclick="openProcessRefundModal(${r.id})">
                <i class="bi bi-send-check me-1"></i> Execute Refund
              </button>
            </td>
          </tr>
        `).join('');
      }
    }

    // Tab 3: All Settlements & Forfeitures
    loadAdminAllEmdRefunds();
  } catch (err) {
    console.error('Error loading admin EMD refund desk:', err);
  }
};

/**
 * Loads all EMD settlements with filter and search
 */
window.loadAdminAllEmdRefunds = function() {
  const table = document.getElementById('admin-emd-refunds-all-table-body');
  if (!table) return;

  const search = (document.getElementById('admin-emd-search-input')?.value || '').toLowerCase();
  const statusFilter = document.getElementById('admin-emd-filter-status')?.value || '';

  let filtered = window.adminEmdCache || [];

  if (search) {
    filtered = filtered.filter(r =>
      (r.original_receipt_no || '').toLowerCase().includes(search) ||
      (r.tender_code || '').toLowerCase().includes(search) ||
      (r.tender_title || '').toLowerCase().includes(search) ||
      (r.company_name || '').toLowerCase().includes(search) ||
      (r.transaction_reference || '').toLowerCase().includes(search)
    );
  }

  if (statusFilter) {
    filtered = filtered.filter(r => r.refund_status === statusFilter);
  }

  if (filtered.length === 0) {
    table.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">No EMD records match the selected criteria.</td></tr>';
    return;
  }

  table.innerHTML = filtered.map(r => `
    <tr>
      <td><strong class="font-monospace text-primary">${r.original_receipt_no || 'EMD-#' + r.id}</strong></td>
      <td><code>${r.tender_code}</code><div class="small text-muted text-truncate" style="max-width: 170px;">${r.tender_title}</div></td>
      <td><strong>${r.company_name}</strong></td>
      <td class="fw-bold">${UI.formatCurrency(r.refund_amount || r.original_emd_amount)}</td>
      <td>${UI.getStatusBadge(r.refund_status)}</td>
      <td>
        ${r.refund_status === 'COMPLETED' ? `
          <span class="badge bg-light text-dark font-monospace border">${r.execution_type === 'GATEWAY_API' ? 'Razorpay API' : 'Bank UTR'}</span>
          <div class="small font-monospace text-success">${r.gateway_refund_id || r.transaction_reference || 'Confirmed'}</div>
        ` : (r.forfeiture_reason ? `<span class="badge bg-danger bg-opacity-10 text-danger border border-danger">Forfeited: ${r.forfeiture_reason}</span>` : '<span class="text-muted small">-</span>')}
      </td>
      <td class="small text-muted">${r.refund_completed_at ? UI.formatDate(r.refund_completed_at) : (r.updated_at ? UI.formatDate(r.updated_at) : '-')}</td>
      <td>
        ${['COMPLETED', 'APPROVED', 'FORFEITED'].includes(r.refund_status) ? `
          <a href="${API.emdRefunds.getAdvicePdfUrl(r.id)}" target="_blank" class="btn btn-sm btn-outline-danger" title="Download Official Advice Slip PDF">
            <i class="bi bi-file-earmark-pdf"></i> Advice
          </a>
        ` : '<span class="text-muted small">-</span>'}
      </td>
    </tr>
  `).join('');
};

/**
 * Opens Assess EMD Modal
 */
window.openAssessEmdModal = async function() {
  const select = document.getElementById('assess-emd-tender-select');
  if (!select) return;

  try {
    const res = await API.tenders.getAll();
    const tenders = (res.tenders || []).filter(t => ['awarded', 'closed', 'cancelled', 'under_evaluation'].includes(t.status));

    select.innerHTML = '<option value="">-- Select Tender --</option>' +
      tenders.map(t => `
        <option value="${t.id}">${t.tender_code} - ${t.title} (${t.status.toUpperCase()})</option>
      `).join('');

    bootstrap.Modal.getOrCreateInstance(document.getElementById('adminAssessEmdModal')).show();
  } catch (err) {
    UI.showToast('Could not load tenders: ' + err.message, 'error');
  }
};

/**
 * Handles running eligibility assessment
 */
window.handleAdminAssessEmdSubmit = async function(event) {
  event.preventDefault();
  const tenderId = document.getElementById('assess-emd-tender-select').value;
  if (!tenderId) return;

  const btn = document.getElementById('btn-submit-assess-emd');
  if (btn) btn.disabled = true;

  try {
    const res = await API.emdRefunds.admin.assessEligibility(tenderId);
    UI.showToast(res.message, 'success');
    bootstrap.Modal.getInstance(document.getElementById('adminAssessEmdModal'))?.hide();
    await loadAdminEmdRefundDesk();
  } catch (err) {
    UI.showToast(err.message || 'Assessment failed.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
};

/**
 * Opens Review Refund Modal
 */
window.openReviewRefundModal = function(refundId) {
  const r = (window.adminEmdCache || []).find(x => x.id == refundId);
  if (!r) return;

  document.getElementById('review-refund-id').value = r.id;
  document.getElementById('review-refund-contractor').textContent = r.company_name;
  document.getElementById('review-refund-tender').textContent = `${r.tender_code} - ${r.tender_title}`;
  document.getElementById('review-refund-original-val').textContent = UI.formatCurrency(r.original_emd_amount);
  document.getElementById('review-refund-type').textContent = r.eligibility_determination || 'Unsuccessful Bidder';
  document.getElementById('review-refund-notes').textContent = r.eligibility_reason || 'Eligible for 100% refund.';

  const amtInput = document.getElementById('review-refund-amount');
  if (amtInput) {
    const defaultAmt = parseFloat(r.refund_eligible_amount) > 0 ? r.refund_eligible_amount : r.original_emd_amount;
    amtInput.value = defaultAmt;
    amtInput.max = r.original_emd_amount;
  }

  document.getElementById('review-refund-remarks').value = '';

  bootstrap.Modal.getOrCreateInstance(document.getElementById('adminReviewRefundModal')).show();
};

/**
 * Handles approving EMD refund
 */
window.handleAdminApproveRefundSubmit = async function() {
  const refundId = document.getElementById('review-refund-id').value;
  const approvedAmount = parseFloat(document.getElementById('review-refund-amount').value);
  const remarks = document.getElementById('review-refund-remarks').value.trim();

  try {
    const res = await API.emdRefunds.admin.approve(refundId, {
      approved_amount: approvedAmount,
      remarks
    });
    UI.showToast(res.message, 'success');
    bootstrap.Modal.getInstance(document.getElementById('adminReviewRefundModal'))?.hide();
    await loadAdminEmdRefundDesk();
  } catch (err) {
    UI.showToast(err.message || 'Approval failed.', 'error');
  }
};

/**
 * Prompts rejection of EMD refund with reason
 */
window.promptRejectRefund = async function() {
  const refundId = document.getElementById('review-refund-id').value;
  const reason = prompt('Enter administrative reason for rejecting this EMD refund request:');
  if (!reason || !reason.trim()) {
    alert('Rejection reason is mandatory.');
    return;
  }

  try {
    const res = await API.emdRefunds.admin.reject(refundId, reason.trim());
    UI.showToast(res.message, 'success');
    bootstrap.Modal.getInstance(document.getElementById('adminReviewRefundModal'))?.hide();
    await loadAdminEmdRefundDesk();
  } catch (err) {
    UI.showToast(err.message || 'Rejection failed.', 'error');
  }
};

/**
 * Prompts forfeiture of EMD deposit with mandatory reason
 */
window.promptForfeitRefund = async function() {
  const refundId = document.getElementById('review-refund-id').value;
  const reason = prompt('CONFIRM EMD FORFEITURE\n\nEnter official tender clause & justification for forfeiting this deposit:');
  if (!reason || !reason.trim()) {
    alert('Forfeiture reason is mandatory by statutory audit rules.');
    return;
  }

  try {
    const res = await API.emdRefunds.admin.forfeit(refundId, reason.trim());
    UI.showToast(res.message, 'success');
    bootstrap.Modal.getInstance(document.getElementById('adminReviewRefundModal'))?.hide();
    await loadAdminEmdRefundDesk();
  } catch (err) {
    UI.showToast(err.message || 'Forfeiture recording failed.', 'error');
  }
};

/**
 * Opens Admin Process Refund Modal
 */
window.openProcessRefundModal = function(refundId) {
  const r = (window.adminEmdCache || []).find(x => x.id == refundId);
  if (!r) return;

  document.getElementById('process-refund-id').value = r.id;
  document.getElementById('process-refund-contractor').textContent = r.company_name;
  document.getElementById('process-refund-tender').textContent = `${r.tender_code} - ${r.tender_title}`;
  document.getElementById('process-refund-amount-val').textContent = UI.formatCurrency(r.refund_amount);
  document.getElementById('process-refund-orig-payment').textContent = r.provider_payment_id || 'Offline / Bank Transfer';

  const execSelect = document.getElementById('process-refund-exec-type');
  if (execSelect) {
    execSelect.value = 'BANK_TRANSFER';
    onRefundExecTypeChanged('BANK_TRANSFER');
  }

  document.getElementById('process-refund-ref').value = '';
  document.getElementById('process-refund-bank').value = 'State Bank of India - MIT Branch';
  document.getElementById('process-refund-notes').value = '';

  bootstrap.Modal.getOrCreateInstance(document.getElementById('adminProcessRefundModal')).show();
};

/**
 * Toggles gateway vs bank fields in refund process modal
 */
window.onRefundExecTypeChanged = function(execType) {
  const bankFields = document.getElementById('process-refund-bank-fields');
  const gatewayNotice = document.getElementById('process-refund-gateway-notice');
  const refInput = document.getElementById('process-refund-ref');

  if (execType === 'RAZORPAY_GATEWAY') {
    if (bankFields) bankFields.classList.add('d-none');
    if (gatewayNotice) gatewayNotice.classList.remove('d-none');
    if (refInput) refInput.required = false;
  } else {
    if (bankFields) bankFields.classList.remove('d-none');
    if (gatewayNotice) gatewayNotice.classList.add('d-none');
    if (refInput) refInput.required = true;
  }
};

/**
 * Submits refund execution
 */
window.handleAdminProcessRefundSubmit = async function(event) {
  event.preventDefault();
  const refundId = document.getElementById('process-refund-id').value;
  const execType = document.getElementById('process-refund-exec-type').value;
  const transactionRef = document.getElementById('process-refund-ref').value.trim();
  const bankDetails = document.getElementById('process-refund-bank').value.trim();
  const notes = document.getElementById('process-refund-notes').value.trim();

  const btn = document.getElementById('btn-submit-process-refund');
  if (btn) btn.disabled = true;

  try {
    const res = await API.emdRefunds.admin.process(refundId, {
      execution_type: execType,
      transaction_reference: transactionRef,
      bank_details: bankDetails,
      remarks: notes
    });
    UI.showToast(res.message, 'success');
    bootstrap.Modal.getInstance(document.getElementById('adminProcessRefundModal'))?.hide();
    await loadAdminEmdRefundDesk();
  } catch (err) {
    UI.showToast(err.message || 'Refund execution failed.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
};

// ====================================================
// MODULE 6: FINANCIAL REPORTING (FRONTEND)
// ====================================================

/**
 * Loads Institutional Financial Liabilities & EMD Settlement Statement
 */
window.loadFinancialReport = async function() {
  try {
    const res = await API.reports.getFinancial();
    if (!res.success || !res.data) return;
    const { contractorPayments: cp, emdRefunds: emd, exceptions: exc } = res.data;

    // Contractor metrics
    const elCpAppr = document.getElementById('report-fin-approved-payable');
    const elCpApprCount = document.getElementById('report-fin-awarded-contracts-count');
    const elCpPaid = document.getElementById('report-fin-payments-completed');
    const elCpPaidCount = document.getElementById('report-fin-settled-contracts-count');
    const elCpRem = document.getElementById('report-fin-remaining-liabilities');
    const elCpPendingVal = document.getElementById('report-fin-pending-claims-val');
    const elCpPendingCount = document.getElementById('report-fin-pending-claims-count');

    if (elCpAppr) elCpAppr.textContent = UI.formatCurrency(cp.totalApprovedPayable);
    if (elCpApprCount) elCpApprCount.textContent = `${cp.totalAwardedContracts} Awarded Contracts`;
    if (elCpPaid) elCpPaid.textContent = UI.formatCurrency(cp.totalPaymentsCompleted);
    if (elCpPaidCount) elCpPaidCount.textContent = `${cp.fullyPaidContractsCount} Fully Settled`;
    if (elCpRem) elCpRem.textContent = UI.formatCurrency(cp.remainingLiabilities);
    if (elCpPendingVal) elCpPendingVal.textContent = UI.formatCurrency(cp.pendingClaimsValue);
    if (elCpPendingCount) elCpPendingCount.textContent = `${cp.pendingClaimsCount} Claims Awaiting Review`;

    // EMD metrics
    const elEmdColl = document.getElementById('report-fin-emd-collected');
    const elEmdCollCount = document.getElementById('report-fin-emd-collected-count');
    const elEmdElig = document.getElementById('report-fin-emd-eligible');
    const elEmdEligCount = document.getElementById('report-fin-emd-eligible-count');
    const elEmdRef = document.getElementById('report-fin-emd-refunded');
    const elEmdRefCount = document.getElementById('report-fin-emd-refunded-count');
    const elEmdForf = document.getElementById('report-fin-emd-forfeited');
    const elEmdForfCount = document.getElementById('report-fin-emd-forfeited-count');

    if (elEmdColl) elEmdColl.textContent = UI.formatCurrency(emd.totalEmdCollected);
    if (elEmdCollCount) elEmdCollCount.textContent = `${emd.totalEmdTransactionsCount} Inbound EMD Deposits`;
    if (elEmdElig) elEmdElig.textContent = UI.formatCurrency(emd.totalEmdEligibleForRefund);
    if (elEmdEligCount) elEmdEligCount.textContent = `${emd.emdEligibleCount} Bidders Eligible`;
    if (elEmdRef) elEmdRef.textContent = UI.formatCurrency(emd.totalEmdRefundsCompletedAmount);
    if (elEmdRefCount) elEmdRefCount.textContent = `${emd.emdRefundsCompletedCount} Successfully Returned`;
    if (elEmdForf) elEmdForf.textContent = UI.formatCurrency(emd.totalEmdForfeituresAmount);
    if (elEmdForfCount) elEmdForfCount.textContent = `${emd.totalEmdForfeituresCount} Deposits Forfeited`;

    // Forfeitures Table
    const forfTable = document.getElementById('report-forfeitures-table-body');
    if (forfTable) {
      const list = emd.forfeituresList || [];
      if (list.length === 0) {
        forfTable.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">No EMD deposits forfeited to date. All evaluated deposits remain eligible or pending review.</td></tr>';
      } else {
        forfTable.innerHTML = list.map(f => `
          <tr>
            <td><code>${f.tender_code}</code><div class="small text-muted text-truncate" style="max-width: 180px;">${f.tender_title || ''}</div></td>
            <td><strong>${f.contractor_name}</strong><div class="small text-muted">${f.license_number || ''}</div></td>
            <td class="fw-bold text-danger">${UI.formatCurrency(f.forfeited_amount)}</td>
            <td>${UI.formatDate(f.forfeiture_date)}</td>
            <td><span class="badge bg-danger bg-opacity-10 text-danger border border-danger">${f.forfeiture_reason || 'Condition breach'}</span></td>
            <td><small class="text-muted">${f.approved_by_name || 'Authority'}</small></td>
          </tr>
        `).join('');
      }
    }

    // Failed & Disputed Table
    const excTable = document.getElementById('report-failed-disputed-table-body');
    if (excTable) {
      const rows = [];
      (exc.failedInboundPayments || []).forEach(p => {
        rows.push(`
          <tr>
            <td><code>${p.receipt_no}</code></td>
            <td><span class="badge bg-secondary">Inbound ${p.payment_type}</span></td>
            <td><code>${p.tender_code}</code></td>
            <td>${p.company_name}</td>
            <td class="fw-bold text-danger">${UI.formatCurrency(p.amount)}</td>
            <td>${UI.formatDateTime(p.failed_at)}</td>
            <td class="text-danger small">${p.failure_reason || 'Gateway Transaction Failed'}</td>
          </tr>
        `);
      });
      (exc.disputedContracts || []).forEach(c => {
        rows.push(`
          <tr>
            <td><code>${c.work_order_ref || 'WO-#' + c.id}</code></td>
            <td><span class="badge bg-warning text-dark">Contract Claim</span></td>
            <td><code>${c.tender_code}</code></td>
            <td>${c.company_name}</td>
            <td class="fw-bold text-warning">${UI.formatCurrency(c.contract_amount)}</td>
            <td>${UI.formatDateTime(c.reported_at)}</td>
            <td class="text-warning small">${c.rejection_reason || 'Work Inspection / Claim Rejected'}</td>
          </tr>
        `);
      });

      if (rows.length === 0) {
        excTable.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3">No failed or disputed transactions recorded. All financial operations fully reconciled.</td></tr>';
      } else {
        excTable.innerHTML = rows.join('');
      }
    }
  } catch (err) {
    console.error('Error loading financial reports:', err);
  }
};


