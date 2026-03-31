/**
 * Notification Service
 * Handles sending notifications via email, SMS, and in-app alerts
 */

const SMTP_CONFIG = {
  enabled: process.env.SMTP_ENABLED === 'true' || false,
  service: process.env.SMTP_SERVICE || 'gmail',
  email: process.env.SMTP_EMAIL || '',
  password: process.env.SMTP_PASSWORD || '',
};

/**
 * Send email notification
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} htmlBody - Email body (HTML)
 * @returns {Promise<boolean>} - True if sent successfully
 */
async function sendEmailNotification(to, subject, htmlBody) {
  if (!to) {
    console.warn('[Email] No recipient email provided');
    return false;
  }

  // Development/demo mode: log to console only
  if (!SMTP_CONFIG.enabled || !SMTP_CONFIG.email) {
    console.log('[Email - Demo Mode]');
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body: ${htmlBody}`);
    return true;
  }

  // Production: use SMTP (requires nodemailer setup)
  try {
    const nodemailer = require('nodemailer');
    
    const transporter = nodemailer.createTransport({
      service: SMTP_CONFIG.service,
      auth: {
        user: SMTP_CONFIG.email,
        pass: SMTP_CONFIG.password,
      },
    });

    await transporter.sendMail({
      from: SMTP_CONFIG.email,
      to,
      subject,
      html: htmlBody,
    });

    console.log(`[Email] Sent to ${to}: ${subject}`);
    return true;
  } catch (err) {
    console.error('[Email] Error sending notification:', err.message);
    return false;
  }
}

/**
 * Notify provider that a request was accepted
 */
function notifyRequestAccepted(providerEmail, providerName, serviceName) {
  const subject = `Request Accepted! 🎉 - ${serviceName}`;
  const htmlBody = `
    <h2>Great news, ${providerName}!</h2>
    <p>You've accepted a service request for <strong>${serviceName}</strong>.</p>
    <p>Head to your dashboard to view details and message the customer.</p>
    <a href="${process.env.APP_URL || 'http://localhost:5173'}/profile" style="background: #0f6e8c; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View Request</a>
  `;
  return sendEmailNotification(providerEmail, subject, htmlBody);
}

/**
 * Notify customer that their request was accepted
 */
function notifyRequestAcceptedToCustomer(customerEmail, customerName, providerName, serviceName) {
  const subject = `Your request was accepted! ✅ - ${serviceName}`;
  const htmlBody = `
    <h2>Good news, ${customerName}!</h2>
    <p><strong>${providerName}</strong> has accepted your service request for <strong>${serviceName}</strong>.</p>
    <p>You can message them directly through the app to coordinate details.</p>
    <a href="${process.env.APP_URL || 'http://localhost:5173'}/profile" style="background: #e8834a; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Message Provider</a>
  `;
  return sendEmailNotification(customerEmail, subject, htmlBody);
}

/**
 * Notify customer that their request was declined
 */
function notifyRequestDeclined(customerEmail, customerName, serviceName) {
  const subject = `Your request update - ${serviceName}`;
  const htmlBody = `
    <h2>Hi ${customerName},</h2>
    <p>A provider declined your service request for <strong>${serviceName}</strong>.</p>
    <p>No worries! You can try requesting from other service professionals.</p>
    <a href="${process.env.APP_URL || 'http://localhost:5173'}/browse" style="background: #0f6e8c; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">Find Another Provider</a>
  `;
  return sendEmailNotification(customerEmail, subject, htmlBody);
}

/**
 * Notify customer that service is completed
 */
function notifyServiceCompleted(customerEmail, customerName, providerName, serviceName) {
  const subject = `Service Complete! ✔️ - Invoice ready`;
  const htmlBody = `
    <h2>Service Completed, ${customerName}!</h2>
    <p><strong>${providerName}</strong> has completed your <strong>${serviceName}</strong> service.</p>
    <p>Your invoice is ready. Please review and provide feedback on their work.</p>
    <a href="${process.env.APP_URL || 'http://localhost:5173'}/profile" style="background: #38a169; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View Invoice</a>
  `;
  return sendEmailNotification(customerEmail, subject, htmlBody);
}

/**
 * Notify provider of new message
 */
function notifyNewMessage(userEmail, userName, senderName) {
  const subject = `New message from ${senderName}`;
  const htmlBody = `
    <h2>You have a new message, ${userName}!</h2>
    <p><strong>${senderName}</strong> sent you a message about a service request.</p>
    <a href="${process.env.APP_URL || 'http://localhost:5173'}/profile" style="background: #0f6e8c; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">View Message</a>
  `;
  return sendEmailNotification(userEmail, subject, htmlBody);
}

module.exports = {
  sendEmailNotification,
  notifyRequestAccepted,
  notifyRequestAcceptedToCustomer,
  notifyRequestDeclined,
  notifyServiceCompleted,
  notifyNewMessage,
};
