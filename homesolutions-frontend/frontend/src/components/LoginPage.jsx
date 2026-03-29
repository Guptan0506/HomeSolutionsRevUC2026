import React, { useState } from 'react';
import { buildApiUrl, getApiErrorMessage, readJsonSafely } from '../api';

function LoginPage({ onLoginSuccess, onSwitchToSignup }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selectedRole, setSelectedRole] = useState('customer');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const response = await fetch(buildApiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, userRole: selectedRole }),
      });

      const data = await readJsonSafely(response);

      if (!response.ok) {
        throw new Error(getApiErrorMessage(response, data, 'Login failed.'));
      }

      if (!data?.user) {
        throw new Error('Unexpected response from server.');
      }

      onLoginSuccess(data.user);
    } catch (err) {
      setError(err.message || 'Unable to login right now.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <p className="auth-kicker">Account Access</p>
        <h1 className="auth-title">Log in to continue</h1>
        <p className="auth-copy">Access your requests, messages, and service history.</p>

        <div className="role-selector">
          <p className="role-label">Login as:</p>
          <div className="role-buttons">
            <button
              type="button"
              className={`role-btn ${selectedRole === 'customer' ? 'active' : ''}`}
              onClick={() => setSelectedRole('customer')}
            >
              Customer
            </button>
            <button
              type="button"
              className={`role-btn ${selectedRole === 'service_provider' ? 'active' : ''}`}
              onClick={() => setSelectedRole('service_provider')}
            >
              Service Provider
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <label className="field-label" htmlFor="login-email">Email</label>
          <input
            id="login-email"
            type="email"
            className="input-field auth-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />

          <label className="field-label" htmlFor="login-password">Password</label>
          <input
            id="login-password"
            type="password"
            className="input-field auth-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            required
          />

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="btn-p auth-submit" disabled={isSubmitting}>
            {isSubmitting ? 'Logging in...' : 'Log In'}
          </button>
        </form>

        <p className="auth-switch-text">
          New here?{' '}
          <button type="button" className="auth-switch-btn" onClick={onSwitchToSignup}>
            Create an account
          </button>
        </p>
      </div>
    </div>
  );
}

export default LoginPage;
