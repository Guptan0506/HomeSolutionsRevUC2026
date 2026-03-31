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

  useEffect(() => {
    fetchAdminData();
  }, []);

  const fetchAdminData = async () => {
    setLoading(true);
    setError('');

    try {
      const [statsRes, usersRes, providersRes, requestsRes, revenueRes] = await Promise.all([
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
    } catch (err) {
      setError(err.message || 'Unable to load admin data');
    } finally {
      setLoading(false);
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
                  </tr>
                </thead>
                <tbody>
                  {users.length > 0 ? (
                    users.map((user) => (
                      <tr key={user.user_id}>
                        <td>{user.user_id}</td>
                        <td>{user.full_name}</td>
                        <td>{user.email}</td>
                        <td>{user.phone || 'N/A'}</td>
                        <td>{user.location || 'N/A'}</td>
                        <td className="metric-badge">{user.request_count || 0}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="6" className="empty-message">
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
                  </tr>
                </thead>
                <tbody>
                  {providers.length > 0 ? (
                    providers.map((provider) => (
                      <tr key={provider.sp_id}>
                        <td>{provider.sp_id}</td>
                        <td>{provider.sp_name}</td>
                        <td>{provider.specialization}</td>
                        <td className="rating-badge">
                          {(provider.avg_rating || 0).toFixed(1)} ⭐
                        </td>
                        <td>{provider.completed_requests || 0}</td>
                        <td>{formatCurrency(provider.hourly_charge || 0)}</td>
                        <td>
                          <span className={`status-badge ${provider.availability ? 'available' : 'unavailable'}`}>
                            {provider.availability ? 'Available' : 'Unavailable'}
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="7" className="empty-message">
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
      </div>

      <div className="admin-footer">
        <button className="btn-p" onClick={fetchAdminData}>
          Refresh Data
        </button>
      </div>
    </div>
  );
}

export default AdminDashboardPage;
