import React, { useState, useEffect } from 'react';
import { buildApiUrl, getAuthHeaders, readJsonSafely, getApiErrorMessage } from '../api';

function formatCurrency(amount) {
  return `$${(Number(amount) || 0).toFixed(2)}`;
}

function AdminDashboardPage({ onLogout, currentUser }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const [users, setUsers] = useState([]);
  const [providers, setProviders] = useState([]);
  const [requests, setRequests] = useState([]);
  const [revenue, setRevenue] = useState(null);
  const [moderationLogs, setModerationLogs] = useState([]);
  const [payments, setPayments] = useState([]);
  const [paymentSummary, setPaymentSummary] = useState(null);
  const [pendingPayouts, setPendingPayouts] = useState([]);
  
  // Modal state
  const [actionModal, setActionModal] = useState(null); // { type, userId, providerId, action }
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [actionReason, setActionReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    fetchAdminData();
  }, []);

  const fetchAdminData = async () => {
    setLoading(true);
    setError('');

    try {
      const [statsRes, usersRes, providersRes, requestsRes, revenueRes, logsRes, paymentsRes, payoutsRes] = await Promise.all([
        fetch(buildApiUrl('/api/admin/stats'), {
          headers: getAuthHeaders(),
        }),
        fetch(buildApiUrl('/api/admin/users'), {
          headers: getAuthHeaders(),
        }),
        fetch(buildApiUrl('/api/admin/providers'), {
          headers: getAuthHeaders(),
        }),
        fetch(buildApiUrl('/api/admin/requests'), {
          headers: getAuthHeaders(),
        }),
        fetch(buildApiUrl('/api/admin/revenue'), {
          headers: getAuthHeaders(),
        }),
        fetch(buildApiUrl('/api/admin/moderation-logs'), {
          headers: getAuthHeaders(),
        }),
        fetch(buildApiUrl('/api/admin/payments'), {
          headers: getAuthHeaders(),
        }),
        fetch(buildApiUrl('/api/admin/pending-payouts'), {
          headers: getAuthHeaders(),
        }),
      ]);

      if (!statsRes.ok) {
        throw new Error('Unable to fetch admin stats');
      }

      const statsData = await readJsonSafely(statsRes);
      setStats(statsData);

      if (usersRes.ok) {
        const usersData = await readJsonSafely(usersRes);
        setUsers(Array.isArray(usersData) ? usersData : []);
      }

      if (providersRes.ok) {
        const providersData = await readJsonSafely(providersRes);
        setProviders(Array.isArray(providersData) ? providersData : []);
      }

      if (requestsRes.ok) {
        const requestsData = await readJsonSafely(requestsRes);
        setRequests(Array.isArray(requestsData) ? requestsData : []);
      }

      if (revenueRes.ok) {
        const revenueData = await readJsonSafely(revenueRes);
        setRevenue(revenueData);
      }

      if (logsRes.ok) {
        const logsData = await readJsonSafely(logsRes);
        setModerationLogs(Array.isArray(logsData) ? logsData : []);
      }

      if (paymentsRes.ok) {
        const paymentsData = await readJsonSafely(paymentsRes);
        setPayments(Array.isArray(paymentsData.transactions) ? paymentsData.transactions : []);
        setPaymentSummary(paymentsData.summary);
      }

      if (payoutsRes.ok) {
        const payoutsData = await readJsonSafely(payoutsRes);
        setPendingPayouts(Array.isArray(payoutsData) ? payoutsData : []);
      }
    } catch (err) {
      setError(err.message || 'Unable to load admin data');
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async () => {
    if (!actionModal) return;

    setActionLoading(true);
    try {
      const { type, userId, providerId, action } = actionModal;
      const endpoint = userId ? `/api/admin/users/${userId}/${action}` : `/api/admin/providers/${providerId}/${action}`;
      
      const response = await fetch(buildApiUrl(endpoint), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          reason: actionReason,
        }),
      });

      if (!response.ok) {
        const errorData = await readJsonSafely(response);
        throw new Error(errorData.message || `Unable to ${action} ${type}`);
      }

      // Show success and refresh data
      setError('');
      setActionModal(null);
      setActionReason('');
      await fetchAdminData();
    } catch (err) {
      setError(err.message || 'Action failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleProcessPayout = async (invoiceId) => {
    setPayoutLoading(true);
    try {
      const response = await fetch(buildApiUrl('/api/admin/process-payout'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ invoiceId }),
      });

      if (!response.ok) {
        const errorData = await readJsonSafely(response);
        throw new Error(errorData.message || 'Failed to process payout');
      }

      setError('');
      await fetchAdminData();
    } catch (err) {
      setError(err.message || 'Payout processing failed');
    } finally {
      setPayoutLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="admin-dashboard">
        <div className="admin-loading">Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div className="admin-dashboard">
      <div className="admin-header">
        <h1>Admin Dashboard</h1>
        <div className="admin-header-actions">
          <span className="admin-user-label">Welcome, Admin</span>
          <button className="btn-s btn-logout" onClick={onLogout}>
            Log Out
          </button>
        </div>
      </div>

      {error && <div className="admin-error">{error}</div>}

      <div className="admin-nav">
        <button
          className={`admin-nav-btn ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </button>
        <button
          className={`admin-nav-btn ${activeTab === 'users' ? 'active' : ''}`}
          onClick={() => setActiveTab('users')}
        >
          Users
        </button>
        <button
          className={`admin-nav-btn ${activeTab === 'providers' ? 'active' : ''}`}
          onClick={() => setActiveTab('providers')}
        >
          Providers
        </button>
        <button
          className={`admin-nav-btn ${activeTab === 'requests' ? 'active' : ''}`}
          onClick={() => setActiveTab('requests')}
        >
          Service Requests
        </button>
        <button
          className={`admin-nav-btn ${activeTab === 'revenue' ? 'active' : ''}`}
          onClick={() => setActiveTab('revenue')}
        >
          Revenue
        </button>
        <button
          className={`admin-nav-btn ${activeTab === 'moderation' ? 'active' : ''}`}
          onClick={() => setActiveTab('moderation')}
        >
          Moderation
        </button>
        <button
          className={`admin-nav-btn ${activeTab === 'payments' ? 'active' : ''}`}
          onClick={() => setActiveTab('payments')}
        >
          Payments
        </button>
      </div>

      <div className="admin-content">
        {activeTab === 'overview' && stats && (
          <div className="admin-overview">
            <div className="stats-grid">
              <div className="stat-card">
                <div className="stat-number">{stats.total_customers || 0}</div>
                <div className="stat-label">Total Customers</div>
                <div className="stat-detail">Active users</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">{stats.total_providers || 0}</div>
                <div className="stat-label">Service Providers</div>
                <div className="stat-detail">Available professionals</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">{stats.active_requests || 0}</div>
                <div className="stat-label">Active Requests</div>
                <div className="stat-detail">In progress or pending</div>
              </div>
              <div className="stat-card">
                <div className="stat-number">{stats.completed_requests || 0}</div>
                <div className="stat-label">Completed</div>
                <div className="stat-detail">Finished requests</div>
              </div>
            </div>

            <div className="overview-grid">
              <div className="overview-section">
                <h3>Request Status Distribution</h3>
                <div className="status-breakdown">
                  <div className="status-item">
                    <span className="status-label">Pending</span>
                    <div className="status-bar">
                      <div
                        className="status-fill pending"
                        style={{
                          width: `${stats.total_requests ? (stats.pending_requests / stats.total_requests) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <span className="status-count">{stats.pending_requests || 0}</span>
                  </div>
                  <div className="status-item">
                    <span className="status-label">In Progress</span>
                    <div className="status-bar">
                      <div
                        className="status-fill in-progress"
                        style={{
                          width: `${stats.total_requests ? (stats.in_progress_requests / stats.total_requests) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <span className="status-count">{stats.in_progress_requests || 0}</span>
                  </div>
                  <div className="status-item">
                    <span className="status-label">Completed</span>
                    <div className="status-bar">
                      <div
                        className="status-fill completed"
                        style={{
                          width: `${stats.total_requests ? (stats.completed_requests / stats.total_requests) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <span className="status-count">{stats.completed_requests || 0}</span>
                  </div>
                  <div className="status-item">
                    <span className="status-label">Rejected</span>
                    <div className="status-bar">
                      <div
                        className="status-fill rejected"
                        style={{
                          width: `${stats.total_requests ? (stats.rejected_requests / stats.total_requests) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <span className="status-count">{stats.rejected_requests || 0}</span>
                  </div>
                </div>
              </div>

              <div className="overview-section">
                <h3>Platform Metrics</h3>
                <div className="metrics-list">
                  <div className="metric-item">
                    <span className="metric-label">Average Rating</span>
                    <span className="metric-value">
                      {(stats.avg_provider_rating || 0).toFixed(1)} ⭐
                    </span>
                  </div>
                  <div className="metric-item">
                    <span className="metric-label">Completion Rate</span>
                    <span className="metric-value">
                      {stats.total_requests ? ((stats.completed_requests / stats.total_requests) * 100).toFixed(1) : 0}%
                    </span>
                  </div>
                  <div className="metric-item">
                    <span className="metric-label">Revenue (Total)</span>
                    <span className="metric-value">{formatCurrency(revenue?.total_revenue || 0)}</span>
                  </div>
                  <div className="metric-item">
                    <span className="metric-label">Platform Commission</span>
                    <span className="metric-value">{formatCurrency(revenue?.total_commission || 0)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'users' && (
          <div className="admin-table-section">
            <h2>Customer Management</h2>
            <div className="admin-table-wrapper">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Location</th>
                    <th>Requests</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.length > 0 ? (
                    users.map((user) => (
                      <tr key={user.user_id} className={user.is_suspended ? 'suspended-row' : ''}>
                        <td>{user.user_id}</td>
                        <td>{user.full_name}</td>
                        <td>{user.email}</td>
                        <td>{user.phone || 'N/A'}</td>
                        <td>{user.location || 'N/A'}</td>
                        <td className="metric-badge">{user.request_count || 0}</td>
                        <td>
                          <span className={`status-badge ${user.is_suspended ? 'suspended' : 'active'}`}>
                            {user.is_suspended ? '🚫 Suspended' : '✓ Active'}
                          </span>
                          {user.warning_count > 0 && <span className="warning-badge">⚠️ {user.warning_count}</span>}
                        </td>
                        <td className="action-cell">
                          {user.is_suspended ? (
                            <button
                              className="btn-action unsuspend"
                              onClick={() =>
                                setActionModal({
                                  type: 'user',
                                  userId: user.user_id,
                                  action: 'unsuspend',
                                })
                              }
                            >
                              Unsuspend
                            </button>
                          ) : (
                            <>
                              <button
                                className="btn-action suspend"
                                onClick={() =>
                                  setActionModal({
                                    type: 'user',
                                    userId: user.user_id,
                                    action: 'suspend',
                                  })
                                }
                              >
                                Suspend
                              </button>
                              <button
                                className="btn-action warn"
                                onClick={() =>
                                  setActionModal({
                                    type: 'user',
                                    userId: user.user_id,
                                    action: 'warn',
                                  })
                                }
                              >
                                Warn
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="8" className="empty-message">
                        No customers yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'providers' && (
          <div className="admin-table-section">
            <h2>Service Provider Management</h2>
            <div className="admin-table-wrapper">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Specialization</th>
                    <th>Rating</th>
                    <th>Completed</th>
                    <th>Rate/Hour</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {providers.length > 0 ? (
                    providers.map((provider) => (
                      <tr key={provider.sp_id} className={provider.is_suspended ? 'suspended-row' : ''}>
                        <td>{provider.sp_id}</td>
                        <td>{provider.sp_name}</td>
                        <td>{provider.specialization}</td>
                        <td className="rating-badge">
                          {(provider.avg_rating || 0).toFixed(1)} ⭐
                        </td>
                        <td>{provider.completed_requests || 0}</td>
                        <td>{formatCurrency(provider.hourly_charge || 0)}</td>
                        <td>
                          <span className={`status-badge ${provider.is_suspended ? 'suspended' : (provider.availability ? 'available' : 'unavailable')}`}>
                            {provider.is_suspended ? '🚫 Suspended' : (provider.availability ? 'Available' : 'Unavailable')}
                          </span>
                          {provider.warning_count > 0 && <span className="warning-badge">⚠️ {provider.warning_count}</span>}
                        </td>
                        <td className="action-cell">
                          {provider.is_suspended ? (
                            <button
                              className="btn-action unsuspend"
                              onClick={() =>
                                setActionModal({
                                  type: 'provider',
                                  providerId: provider.sp_id,
                                  action: 'unsuspend',
                                })
                              }
                            >
                              Unsuspend
                            </button>
                          ) : (
                            <>
                              <button
                                className="btn-action suspend"
                                onClick={() =>
                                  setActionModal({
                                    type: 'provider',
                                    providerId: provider.sp_id,
                                    action: 'suspend',
                                  })
                                }
                              >
                                Suspend
                              </button>
                              <button
                                className="btn-action warn"
                                onClick={() =>
                                  setActionModal({
                                    type: 'provider',
                                    providerId: provider.sp_id,
                                    action: 'warn',
                                  })
                                }
                              >
                                Warn
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="8" className="empty-message">
                        No providers registered yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'requests' && (
          <div className="admin-table-section">
            <h2>Service Requests</h2>
            <div className="admin-table-wrapper">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Service</th>
                    <th>Customer</th>
                    <th>Provider</th>
                    <th>Status</th>
                    <th>Amount</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.length > 0 ? (
                    requests.slice(0, 20).map((request) => (
                      <tr key={request.request_id}>
                        <td>#{request.request_id}</td>
                        <td>{request.service_name}</td>
                        <td>{request.customer_name}</td>
                        <td>{request.provider_name || 'Unassigned'}</td>
                        <td>
                          <span className={`status-badge ${request.status}`}>
                            {request.status === 'in_progress' ? 'In Progress' : request.status}
                          </span>
                        </td>
                        <td>{formatCurrency(request.total_amount || 0)}</td>
                        <td>{new Date(request.submitted_at).toLocaleDateString()}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="7" className="empty-message">
                        No requests found
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'revenue' && revenue && (
          <div className="admin-revenue-section">
            <h2>Revenue Analytics</h2>
            <div className="revenue-cards">
              <div className="revenue-card">
                <div className="revenue-label">Total Revenue</div>
                <div className="revenue-value">{formatCurrency(revenue.total_revenue)}</div>
                <div className="revenue-detail">{revenue.completed_invoices || 0} transactions</div>
              </div>
              <div className="revenue-card">
                <div className="revenue-label">Platform Commission (5%)</div>
                <div className="revenue-value">{formatCurrency(revenue.total_commission)}</div>
                <div className="revenue-detail">From completed services</div>
              </div>
              <div className="revenue-card">
                <div className="revenue-label">Provider Payouts</div>
                <div className="revenue-value">{formatCurrency(revenue.total_payouts)}</div>
                <div className="revenue-detail">95% to professionals</div>
              </div>
              <div className="revenue-card">
                <div className="revenue-label">Average Transaction</div>
                <div className="revenue-value">
                  {formatCurrency(revenue.avg_transaction || 0)}
                </div>
                <div className="revenue-detail">Per completed request</div>
              </div>
            </div>

            <div className="revenue-breakdown">
              <h3>Revenue by Service Type</h3>
              <div className="service-revenue-list">
                {revenue.by_service && Object.entries(revenue.by_service).length > 0 ? (
                  Object.entries(revenue.by_service).map(([service, amount]) => (
                    <div key={service} className="service-revenue-item">
                      <span className="service-name">{service}</span>
                      <span className="service-amount">{formatCurrency(amount)}</span>
                    </div>
                  ))
                ) : (
                  <p className="empty-message">No revenue data available</p>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'moderation' && (
          <div className="admin-table-section">
            <h2>Moderation Logs</h2>
            <div className="admin-table-wrapper">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Admin</th>
                    <th>Target</th>
                    <th>Action</th>
                    <th>Reason</th>
                    <th>Details</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {moderationLogs.length > 0 ? (
                    moderationLogs.slice(0, 50).map((log) => (
                      <tr key={log.log_id}>
                        <td>{log.admin_name || 'System'}</td>
                        <td>
                          {log.target_user_name ? (
                            <>
                              <strong>{log.target_user_name}</strong> (User #{log.target_user_id})
                            </>
                          ) : log.target_provider_name ? (
                            <>
                              <strong>{log.target_provider_name}</strong> (Provider #{log.target_provider_id})
                            </>
                          ) : (
                            'Unknown'
                          )}
                        </td>
                        <td>
                          <span className={`action-badge ${log.action_type.toLowerCase()}`}>
                            {log.action_type.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td>{log.reason || '-'}</td>
                        <td className="details-cell">{log.details || '-'}</td>
                        <td>{new Date(log.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="6" className="empty-message">
                        No moderation actions yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'payments' && (
          <div className="payments-tab-content">
            <h2>Payment Management</h2>
            
            {/* Payment Summary */}
            {paymentSummary && (
              <div className="payments-summary">
                <div className="summary-card">
                  <div className="summary-label">Total Revenue</div>
                  <div className="summary-value">{formatCurrency(paymentSummary.totalRevenue)}</div>
                </div>
                <div className="summary-card">
                  <div className="summary-label">Total Commissions</div>
                  <div className="summary-value">{formatCurrency(paymentSummary.totalCommissions)}</div>
                </div>
                <div className="summary-card">
                  <div className="summary-label">Completed Payments</div>
                  <div className="summary-value">{paymentSummary.completedPayments}</div>
                </div>
                <div className="summary-card">
                  <div className="summary-label">Pending Payouts</div>
                  <div className="summary-value" style={{ color: '#d97706' }}>{pendingPayouts.length}</div>
                </div>
              </div>
            )}

            {/* Pending Payouts Section */}
            {pendingPayouts.length > 0 && (
              <div className="admin-table-section" style={{ marginTop: '24px' }}>
                <h3>Pending Provider Payouts</h3>
                <div className="admin-table-wrapper">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Provider</th>
                        <th>Customer</th>
                        <th>Invoice ID</th>
                        <th>Total Amount</th>
                        <th>Payout Amount</th>
                        <th>Payment Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingPayouts.slice(0, 50).map((payout) => (
                        <tr key={payout.invoice_id}>
                          <td><strong>{payout.business_name}</strong></td>
                          <td>{payout.customer_name || 'Unknown'}</td>
                          <td>#{payout.invoice_id}</td>
                          <td>{formatCurrency(payout.total_amount)}</td>
                          <td style={{ fontWeight: '600', color: '#2ecc71' }}>
                            {formatCurrency(payout.provider_payout_amount)}
                          </td>
                          <td>
                            <span className="payment-status-badge completed">
                              {payout.payment_status}
                            </span>
                          </td>
                          <td>
                            <button
                              className="btn-s"
                              onClick={() => handleProcessPayout(payout.invoice_id)}
                              disabled={payoutLoading}
                            >
                              {payoutLoading ? 'Processing...' : 'Process'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* All Transactions */}
            <div className="admin-table-section" style={{ marginTop: '24px' }}>
              <h3>Payment Transactions</h3>
              <div className="admin-table-wrapper">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Invoice ID</th>
                      <th>Customer</th>
                      <th>Provider</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Payout Status</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.length > 0 ? (
                      payments.slice(0, 100).map((payment) => (
                        <tr key={payment.invoice_id}>
                          <td>#{payment.invoice_id}</td>
                          <td>{payment.customer_name || 'Unknown'}</td>
                          <td>{payment.provider_name || 'Unknown'}</td>
                          <td>{formatCurrency(payment.total_amount)}</td>
                          <td>
                            <span className={`payment-status-badge ${payment.payment_status}`}>
                              {payment.payment_status}
                            </span>
                          </td>
                          <td>
                            <span className={`payout-status-badge ${payment.payout_status}`}>
                              {payment.payout_status}
                            </span>
                          </td>
                          <td>
                            {payment.paid_at ? new Date(payment.paid_at).toLocaleDateString() : '-'}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="7" className="empty-message">
                          No payment transactions yet
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Action Modal */}
      {actionModal && (
        <div className="admin-modal-overlay" onClick={() => !actionLoading && setActionModal(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h3>
              {actionModal.action === 'suspend'
                ? `Suspend ${actionModal.type}`
                : actionModal.action === 'unsuspend'
                  ? `Unsuspend ${actionModal.type}`
                  : `Warn ${actionModal.type}`}
            </h3>
            {(actionModal.action === 'suspend' || actionModal.action === 'warn') && (
              <div className="form-group">
                <label>Reason:</label>
                <textarea
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  placeholder="Enter reason for this action..."
                  disabled={actionLoading}
                />
              </div>
            )}
            <div className="modal-actions">
              <button
                className="btn-s"
                onClick={() => setActionModal(null)}
                disabled={actionLoading}
              >
                Cancel
              </button>
              <button
                className={`btn-p ${actionModal.action === 'suspend' ? 'btn-danger' : ''}`}
                onClick={handleAction}
                disabled={actionLoading}
              >
                {actionLoading ? 'Processing...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="admin-footer">
        <button className="btn-p" onClick={fetchAdminData} disabled={actionLoading}>
          Refresh Data
        </button>
      </div>
    </div>
  );
}

export default AdminDashboardPage;
