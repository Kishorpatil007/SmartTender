/**
 * API Client & Network Helper for MIT Chhatrapati Sambhajinagar Smart Tender System
 */

const API_BASE = '/api';

const API = {
  // Token Management
  getToken: () => localStorage.getItem('mit_tender_token'),
  setToken: (token) => localStorage.setItem('mit_tender_token', token),
  removeToken: () => localStorage.removeItem('mit_tender_token'),

  // User Session
  getUser: () => {
    const userStr = localStorage.getItem('mit_tender_user');
    return userStr ? JSON.parse(userStr) : null;
  },
  setUser: (user) => localStorage.setItem('mit_tender_user', JSON.stringify(user)),
  removeUser: () => localStorage.removeItem('mit_tender_user'),

  // Generic Request Helper
  async request(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const headers = options.headers || {};

    const token = API.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (!(options.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const config = {
      ...options,
      headers
    };

    try {
      const res = await fetch(url, config);
      const data = await res.json();

      if (!res.ok) {
        if (res.status === 401 && !endpoint.includes('/auth/login')) {
          API.removeToken();
          API.removeUser();
          window.location.reload();
        }
        throw new Error(data.message || `HTTP Error ${res.status}`);
      }

      return data;
    } catch (err) {
      console.error(`API Error on [${options.method || 'GET'} ${endpoint}]:`, err);
      throw err;
    }
  },

  // Auth Endpoints
  auth: {
    login: (email, password) => API.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    }),
    register: (userData) => API.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(userData)
    }),
    requestStaffAccount: (staffData) => API.request('/auth/request-staff-account', {
      method: 'POST',
      body: JSON.stringify(staffData)
    }),
    verifyInvitation: (token, email) => API.request(`/auth/verify-invitation?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`),
    setPassword: (data) => API.request('/auth/set-password', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
    forgotPassword: (email) => API.request('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email })
    }),
    resetPassword: (data) => API.request('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
    verifyEmail: (data) => API.request('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
    getProfile: () => API.request('/auth/me'),
    getAdminStatus: () => API.request('/auth/admin-status')
  },

  // Tender Endpoints
  tenders: {
    getAll: (params = '') => API.request(`/tenders${params}`),
    getById: (id) => API.request(`/tenders/${id}`),
    create: (data) => API.request('/tenders', {
      method: 'POST',
      body: data instanceof FormData ? data : JSON.stringify(data)
    }),
    update: (id, data) => API.request(`/tenders/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    }),
    publish: (id) => API.request(`/tenders/${id}/publish`, { method: 'PUT' }),
    closeBidding: (id) => API.request(`/tenders/${id}/close-bidding`, { method: 'PUT' }),
    delete: (id) => API.request(`/tenders/${id}`, { method: 'DELETE' }),
    uploadDoc: (tenderId, formData) => API.request(`/tenders/${tenderId}/documents`, {
      method: 'POST',
      body: formData
    })
  },

  // Contractor Endpoints
  contractor: {
    getProfile: () => API.request('/contractor/profile'),
    updateProfile: (data) => API.request('/contractor/profile', {
      method: 'PUT',
      body: JSON.stringify(data)
    }),
    getMyBids: () => API.request('/contractor/my-bids'),
    submitBid: (formData) => API.request('/contractor/bids', {
      method: 'POST',
      body: formData
    }),
    getBidDetail: (id) => API.request(`/contractor/bids/${id}`)
  },

  // Evaluation Endpoints
  evaluation: {
    getTenders: () => API.request('/evaluation/tenders'),
    getTenderBids: (tenderId) => API.request(`/evaluation/tenders/${tenderId}/bids`),
    scoreBid: (data) => API.request('/evaluation/score', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
    awardTender: (data) => API.request('/evaluation/award', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  },

  // Admin Endpoints
  admin: {
    getStats: () => API.request('/admin/stats'),
    getUsers: (params = '') => API.request(`/admin/users${params}`),
    getStaffRequests: (params = '') => API.request(`/admin/staff-requests${params}`),
    getUserDetails: (id) => API.request(`/admin/users/${id}/details`),
    approveStaffRequest: (id) => API.request(`/admin/staff-requests/${id}/approve`, {
      method: 'POST'
    }),
    rejectStaffRequest: (id, reason) => API.request(`/admin/staff-requests/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    }),
    createUser: (userData) => API.request('/admin/users', {
      method: 'POST',
      body: JSON.stringify(userData)
    }),
    updateUserStatus: (id, status) => API.request(`/admin/users/${id}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status })
    }),
    verifyUser: (id, status) => API.request(`/admin/users/${id}/verify`, {
      method: 'PUT',
      body: JSON.stringify({ status })
    }),
    deleteUser: (id) => API.request(`/admin/users/${id}`, { method: 'DELETE' }),
    getContractors: (params = '') => API.request(`/admin/contractors${params}`),
    verifyContractor: (id, status) => API.request(`/admin/contractors/${id}/verify`, {
      method: 'PUT',
      body: JSON.stringify({ status })
    }),
    deleteStaffRequest: (id) => API.request(`/admin/staff-requests/${id}`, { method: 'DELETE' }),
    deleteContractor: (id) => API.request(`/admin/contractors/${id}`, { method: 'DELETE' }),
    getAuditLogs: () => API.request('/admin/audit-logs'),
    getDepartments: () => API.request('/admin/departments')
  },

  // Reports & PDF Endpoints
  reports: {
    getSummary: () => API.request('/reports/summary'),
    getTenderHistory: () => API.request('/reports/tender-history'),
    getContractorPerformance: () => API.request('/reports/contractor-performance'),
    getPdfUrl: (tenderId, type = 'comparative') => `/api/reports/tender/${tenderId}/pdf?type=${type}`
  },

  // AI Chatbot Endpoints
  ai: {
    chat: (message, history = []) => API.request('/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ message, history })
    }),
    getSuggestions: () => API.request('/ai/suggestions')
  },

  // Payments Endpoints (Tender Fee & EMD)
  payments: {
    getConfig: () => API.request('/payments/config'),
    createOrder: (tenderId, paymentType) => API.request('/payments/create-order', {
      method: 'POST',
      body: JSON.stringify({ tender_id: tenderId, payment_type: paymentType })
    }),
    verify: (data) => API.request('/payments/verify', {
      method: 'POST',
      body: JSON.stringify(data)
    }),
    getHistory: (tenderId) => API.request(`/payments/history${tenderId ? `?tenderId=${tenderId}` : ''}`),
    getTenderStatus: (tenderId) => API.request(`/payments/tender/${tenderId}/status`),
    getById: (id) => API.request(`/payments/${id}`),
    getPdfUrl: (id) => `/api/payments/${id}/receipt-pdf?token=${API.getToken()}`,
    admin: {
      getPayments: (queryString = '') => API.request(`/admin/payments${queryString}`),
      getStats: () => API.request('/admin/payments/stats'),
      refund: (id, reason) => API.request(`/admin/payments/${id}/refund`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      })
    }
  },

  // Module 1: Contractor Payment Management (Institution -> Selected Contractor)
  contractorPayments: {
    getAll: (tenderId) => API.request(`/contractor-payments${tenderId ? `?tenderId=${tenderId}` : ''}`),
    getAwardedTenders: () => API.request('/contractor-payments/awarded-tenders'),
    getById: (id) => API.request(`/contractor-payments/${id}`),
    getHistory: (id) => API.request(`/contractor-payments/${id}/history`),
    submitClaim: (formData) => API.request('/contractor-payments/claims', {
      method: 'POST',
      body: formData
    }),
    getVoucherUrl: (id) => `/api/contractor-payments/${id}/voucher-pdf?token=${API.getToken()}`,
    admin: {
      getAll: (queryString = '') => API.request(`/contractor-payments/admin/all${queryString}`),
      getStats: () => API.request('/contractor-payments/stats'),
      initialize: (tenderId) => API.request('/contractor-payments/initialize', {
        method: 'POST',
        body: JSON.stringify({ tender_id: tenderId })
      }),
      updateWorkStatus: (id, status, notes) => API.request(`/contractor-payments/${id}/work-status`, {
        method: 'POST',
        body: JSON.stringify({ status, notes })
      }),
      inspectWork: (id, approved, inspection_notes) => API.request(`/contractor-payments/${id}/inspect`, {
        method: 'POST',
        body: JSON.stringify({ approved, inspection_notes })
      }),
      approveClaim: (id, data) => API.request(`/contractor-payments/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify(data)
      }),
      rejectClaim: (id, reason) => API.request(`/contractor-payments/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      }),
      recordPayment: (id, formData) => API.request(`/contractor-payments/${id}/record-payment`, {
        method: 'POST',
        body: formData
      })
    }
  },

  // Module 2: EMD Refund Management (Institution -> Eligible Contractor)
  emdRefunds: {
    getAll: (tenderId) => API.request(`/emd-refunds${tenderId ? `?tenderId=${tenderId}` : ''}`),
    getById: (id) => API.request(`/emd-refunds/${id}`),
    getHistory: (id) => API.request(`/emd-refunds/${id}/history`),
    getVoucherUrl: (id) => `/api/emd-refunds/${id}/voucher-pdf?token=${API.getToken()}`,
    admin: {
      getAll: (queryString = '') => API.request(`/emd-refunds/admin/all${queryString}`),
      getStats: () => API.request('/emd-refunds/stats'),
      assessEligibility: (tenderId) => API.request('/emd-refunds/assess-eligibility', {
        method: 'POST',
        body: JSON.stringify({ tender_id: tenderId })
      }),
      approve: (id, data = {}) => API.request(`/emd-refunds/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify(data)
      }),
      reject: (id, reason) => API.request(`/emd-refunds/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      }),
      forfeit: (id, reason) => API.request(`/emd-refunds/${id}/forfeit`, {
        method: 'POST',
        body: JSON.stringify({ reason })
      }),
      process: (id, data) => API.request(`/emd-refunds/${id}/process`, {
        method: 'POST',
        body: JSON.stringify(data)
      })
    }
  },

  // Reports
  reports: {
    getSummary: () => API.request('/reports/summary'),
    getFinancial: () => API.request('/reports/financial'),
    getTenderHistory: () => API.request('/reports/tender-history'),
    getContractorPerformance: () => API.request('/reports/contractor-performance')
  }
};

// UI Helper Utilities
const UI = {
  formatCurrency: (amount) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(amount || 0).replace('₹', '₹ ');
  },

  formatDate: (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  },

  formatDateTime: (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  },

  getStatusBadge: (status) => {
    const statusMap = {
      draft: { class: 'badge-draft', label: 'Draft' },
      published: { class: 'badge-published', label: 'Published / Open' },
      under_evaluation: { class: 'badge-under_evaluation', label: 'Under Evaluation' },
      awarded: { class: 'badge-awarded', label: 'Awarded' },
      closed: { class: 'badge-closed', label: 'Closed' },
      cancelled: { class: 'badge-cancelled', label: 'Cancelled' },
      submitted: { class: 'badge-published', label: 'Submitted' },
      under_review: { class: 'badge-under_evaluation', label: 'Under Review' },
      qualified: { class: 'badge-awarded', label: 'Tech Qualified' },
      disqualified: { class: 'badge-cancelled', label: 'Disqualified' },
      rejected: { class: 'badge-cancelled', label: 'Rejected' },
      pending: { class: 'badge-under_evaluation', label: 'Pending Verification' },
      approved: { class: 'badge-awarded', label: 'Verified & Approved' },
      // Payment statuses
      PAID: { class: 'badge-awarded', label: 'Paid / Confirmed' },
      paid: { class: 'badge-awarded', label: 'Paid / Confirmed' },
      CREATED: { class: 'badge-draft', label: 'Order Created' },
      created: { class: 'badge-draft', label: 'Order Created' },
      PENDING: { class: 'badge-under_evaluation', label: 'Pending' },
      pending_payment: { class: 'badge-under_evaluation', label: 'Pending Payment' },
      FAILED: { class: 'badge-cancelled', label: 'Payment Failed' },
      failed: { class: 'badge-cancelled', label: 'Payment Failed' },
      REFUND_PENDING: { class: 'badge-under_evaluation', label: 'Refund Pending' },
      REFUNDED: { class: 'badge-closed', label: 'Refunded' },
      refunded: { class: 'badge-closed', label: 'Refunded' },
      // Contractor Payment: Work Statuses
      contract_awarded: { class: 'badge-draft', label: 'Contract Awarded' },
      work_in_progress: { class: 'badge-under_evaluation', label: 'Work In Progress' },
      completion_submitted: { class: 'badge-published', label: 'Completion Submitted' },
      inspection_pending: { class: 'badge-under_evaluation', label: 'Inspection Pending' },
      inspection_approved: { class: 'badge-awarded', label: 'Inspection Approved' },
      inspection_rejected: { class: 'badge-cancelled', label: 'Inspection Rejected' },
      disputed: { class: 'badge-cancelled', label: 'Disputed' },
      // Contractor Payment: Claim Statuses
      claim_submitted: { class: 'badge-published', label: 'Claim Submitted' },
      approval_pending: { class: 'badge-under_evaluation', label: 'Approval Pending' },
      partially_paid: { class: 'badge-under_evaluation', label: 'Partially Paid' },
      fully_paid: { class: 'badge-awarded', label: 'Fully Paid & Settled' },
      // EMD Refund Statuses
      ELIGIBLE: { class: 'badge-published', label: 'Refund Eligible' },
      PENDING_REVIEW: { class: 'badge-under_evaluation', label: 'Review Pending' },
      APPROVED: { class: 'badge-awarded', label: 'Refund Approved' },
      PROCESSING: { class: 'badge-under_evaluation', label: 'Processing' },
      COMPLETED: { class: 'badge-awarded', label: 'Refund Completed' },
      FORFEITED: { class: 'badge-cancelled', label: 'Deposit Forfeited' }
    };

    const config = statusMap[status] || { class: 'badge-draft', label: status };
    return `<span class="badge-status ${config.class}">${config.label}</span>`;
  },

  showToast: (message, type = 'success') => {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toastId = 'toast-' + Date.now();
    const bgClass = type === 'success' ? 'bg-success text-white' : type === 'error' ? 'bg-danger text-white' : 'bg-primary text-white';

    const toastHTML = `
      <div id="${toastId}" class="toast align-items-center ${bgClass} border-0 show mb-2" role="alert" aria-live="assertive" aria-atomic="true">
        <div class="d-flex">
          <div class="toast-body d-flex align-items-center gap-2">
            <i class="bi ${type === 'success' ? 'bi-check-circle-fill' : type === 'error' ? 'bi-exclamation-octagon-fill' : 'bi-info-circle-fill'}"></i>
            <div>${message}</div>
          </div>
          <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
      </div>
    `;

    container.insertAdjacentHTML('beforeend', toastHTML);
    setTimeout(() => {
      const toastEl = document.getElementById(toastId);
      if (toastEl) toastEl.remove();
    }, 4000);
  }
};
