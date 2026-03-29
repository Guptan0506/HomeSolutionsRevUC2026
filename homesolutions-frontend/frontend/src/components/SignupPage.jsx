import React, { useState } from 'react';
import { buildApiUrl, getApiErrorMessage, readJsonSafely } from '../api';

function SignupPage({ onSignupSuccess, onSwitchToLogin }) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [selectedRole, setSelectedRole] = useState('customer');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Service provider specific fields
  const [specialization, setSpecialization] = useState('');
  const [hourlyCharge, setHourlyCharge] = useState('');
  const [experienceYears, setExperienceYears] = useState('');
  const [services, setServices] = useState('');
  const [profilePictureUrl, setProfilePictureUrl] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!selectedRole || selectedRole === '') {
      setError('Please select a role (Customer or Service Provider).');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    // Validate service provider fields
    if (selectedRole === 'service_provider') {
      if (!specialization.trim()) {
        setError('Please enter your specialization.');
        return;
      }
      if (!hourlyCharge.trim()) {
        setError('Please enter your base hourly charge.');
        return;
      }
      if (isNaN(parseFloat(hourlyCharge))) {
        setError('Base charge must be a valid number.');
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const requestBody = { 
        fullName, 
        email, 
        password, 
        userRole: selectedRole 
      };

      // Add service provider fields if applicable
      if (selectedRole === 'service_provider') {
        requestBody.specialization = specialization;
        requestBody.hourlyCharge = parseFloat(hourlyCharge);
        requestBody.experienceYears = experienceYears ? parseInt(experienceYears) : 0;
        requestBody.services = services;
        requestBody.profilePictureUrl = profilePictureUrl;
      }

      console.log('Signup request body:', requestBody);
      
      const response = await fetch(buildApiUrl('/api/auth/signup'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const data = await readJsonSafely(response);

      if (!response.ok) {
        throw new Error(getApiErrorMessage(response, data, 'Sign up failed.'));
      }

      console.log('Signup response received:', data);

      if (!data?.user) {
        throw new Error('Unexpected response from server.');
      }

      onSignupSuccess(data.user);
    } catch (err) {
      setError(err.message || 'Unable to create account right now.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <p className="auth-kicker">New Account</p>
        <h1 className="auth-title">Create your profile</h1>
        <p className="auth-copy">Join HomeSolutions and book trusted professionals anytime.</p>

        <div className="role-selector">
          <p className="role-label">Join as:</p>
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
          <label className="field-label" htmlFor="signup-name">Full Name</label>
          <input
            id="signup-name"
            type="text"
            className="input-field auth-input"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Alex Johnson"
            required
          />

          <label className="field-label" htmlFor="signup-email">Email</label>
          <input
            id="signup-email"
            type="email"
            className="input-field auth-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
          />

          <label className="field-label" htmlFor="signup-password">Password</label>
          <input
            id="signup-password"
            type="password"
            className="input-field auth-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 6 characters"
            required
          />

          <label className="field-label" htmlFor="signup-confirm-password">Confirm Password</label>
          <input
            id="signup-confirm-password"
            type="password"
            className="input-field auth-input"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter password"
            required
          />

          {selectedRole === 'service_provider' && (
            <>
              <label className="field-label" htmlFor="signup-specialization">Specialization</label>
              <input
                id="signup-specialization"
                type="text"
                className="input-field auth-input"
                value={specialization}
                onChange={(e) => setSpecialization(e.target.value)}
                placeholder="e.g., Plumbing, Electrical, Cleaning"
                required={selectedRole === 'service_provider'}
              />

              <label className="field-label" htmlFor="signup-charge">Base Hourly Charge ($)</label>
              <input
                id="signup-charge"
                type="number"
                className="input-field auth-input"
                value={hourlyCharge}
                onChange={(e) => setHourlyCharge(e.target.value)}
                placeholder="e.g., 50"
                step="0.01"
                min="0"
                required={selectedRole === 'service_provider'}
              />

              <label className="field-label" htmlFor="signup-experience">Years of Experience</label>
              <input
                id="signup-experience"
                type="number"
                className="input-field auth-input"
                value={experienceYears}
                onChange={(e) => setExperienceYears(e.target.value)}
                placeholder="e.g., 5"
                min="0"
              />

              <label className="field-label" htmlFor="signup-services">Services Offered</label>
              <input
                id="signup-services"
                type="text"
                className="input-field auth-input"
                value={services}
                onChange={(e) => setServices(e.target.value)}
                placeholder="e.g., Installation, Repair, Maintenance"
              />

              <label className="field-label" htmlFor="signup-picture">Profile Picture URL</label>
              <input
                id="signup-picture"
                type="url"
                className="input-field auth-input"
                value={profilePictureUrl}
                onChange={(e) => setProfilePictureUrl(e.target.value)}
                placeholder="https://example.com/photo.jpg"
              />
            </>
          )}

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="btn-p auth-submit" disabled={isSubmitting}>
            {isSubmitting ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <p className="auth-switch-text">
          Already have an account?{' '}
          <button type="button" className="auth-switch-btn" onClick={onSwitchToLogin}>
            Log in
          </button>
        </p>
      </div>
    </div>
  );
}

export default SignupPage;
