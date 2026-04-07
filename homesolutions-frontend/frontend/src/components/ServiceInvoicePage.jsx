import React, { useState, useEffect } from 'react';
import { buildApiUrl, getAuthHeaders } from '../api';
import { PaymentForm } from './PaymentForm';
import { money } from './formatMoney';

function splitDateTime(value) {
  if (!value) {
    return { date: 'N/A', time: 'N/A' };
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return { date: value, time: 'N/A' };
  }

  return {
    date: date.toLocaleDateString(),
    time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };
}

function ServiceInvoicePage({ invoiceRequest, onBackToProfile }) {
  const [paymentStatus, setPaymentStatus] = useState('pending');
  const [successMessage, setSuccessMessage] = useState('');

  // Check payment status
  useEffect(() => {
    if (invoiceRequest?.invoiceId) {
      fetch(buildApiUrl(`/api/invoices/${invoiceRequest.invoiceId}/payment-status`), {
        headers: getAuthHeaders(),
      })
        .then((res) => res.json())
        .then((data) => {
          setPaymentStatus(data.paymentStatus || 'pending');
        })
        .catch((err) => console.error('Error checking payment status:', err));
    }
  }, [invoiceRequest?.invoiceId]);

  if (!invoiceRequest) {
    return (
      <section className="section-wrap">
        <div className="state-card error">
          <p className="state-title">Invoice unavailable</p>
          <p className="state-copy">No completed request is selected yet.</p>
          <button type="button" className="btn-s" style={{ marginTop: '10px' }} onClick={onBackToProfile}>
            Back to Profile
          </button>
        </div>
      </section>
    );
  }

  const requestDateTime = splitDateTime(invoiceRequest.requestedAt);
  const completionDateTime = splitDateTime(invoiceRequest.completionAt);
  const baseRatePerHour = Number(invoiceRequest.baseRatePerHour || 0);
  const hoursWorked = Number(invoiceRequest.hoursWorked || 0);
  const laborCost = baseRatePerHour * hoursWorked;
  const materialCost = Number(invoiceRequest.extraMaterialsCost || 0);
  const urgentExtraFee = Number(invoiceRequest.extraFee || 0);
  const subtotal = laborCost + materialCost + urgentExtraFee;
  const tax = subtotal * 0.07;
  const commission = subtotal * 0.05;
  const total = subtotal + tax + commission;
  const isPaid = paymentStatus === 'completed';

  return (
    <section className="section-wrap invoice-wrap">
      <div className="sec-label">Invoice</div>
      <div className="card invoice-card">
        <p className="invoice-title">Service Invoice</p>

        {successMessage && <div className="success-message">{successMessage}</div>}
        {isPaid && <div className="success-message">✓ Payment received</div>}

        <p className="history-line">
          <strong>Status:</strong>
          {isPaid ? (
            <span style={{ color: '#2ecc71', marginLeft: '8px' }}>✓ Paid</span>
          ) : (
            <span style={{ color: '#ef8354', marginLeft: '8px' }}>Pending Payment</span>
          )}
        </p>

        <p className="history-line"><strong>RequestID:</strong> {invoiceRequest.requestId}</p>
        <p className="history-line"><strong>Request Date:</strong> {requestDateTime.date}</p>
        <p className="history-line"><strong>Request Time:</strong> {requestDateTime.time}</p>
        <p className="history-line"><strong>Completion Date:</strong> {completionDateTime.date}</p>
        <p className="history-line"><strong>Completion Time:</strong> {completionDateTime.time}</p>
        <p className="history-line">
          <strong>Base Rate X Hours Worked:</strong> {money(baseRatePerHour)} x {hoursWorked} =
          {money(laborCost)}
        </p>
        <p className="history-line"><strong>Cost of Extra Materials Used:</strong> {money(materialCost)}</p>
        <p className="history-line"><strong>Extra Fee (Urgent Optional):</strong> {money(urgentExtraFee)}</p>
        <p className="history-line"><strong>Subtotal:</strong> {money(subtotal)}</p>
        <p className="history-line"><strong>Tax 7%:</strong> {money(tax)}</p>
        <p className="history-line"><strong>Commission 5%:</strong> {money(commission)}</p>
        <p className="history-line invoice-total">
          <strong>Total:</strong> {money(total)}
        </p>

        {!isPaid && (
          <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid #dbe4ec' }}>
            <h4 style={{ marginBottom: '16px', fontSize: '16px', fontWeight: '600' }}>Payment Details</h4>
            <PaymentForm
              invoiceId={invoiceRequest.invoiceId}
              totalAmount={total}
              onPaymentSuccess={(msg) => {
                setSuccessMessage(msg);
                setPaymentStatus('completed');
                setTimeout(() => setSuccessMessage(''), 3000);
              }}
              onPaymentError={(err) => {
                console.error('Payment error:', err);
              }}
            />
          </div>
        )}

        <button type="button" className="btn-p" style={{ marginTop: '24px' }} onClick={onBackToProfile}>
          Back to Service Provider Profile
        </button>
      </div>
    </section>
  );
}

export default ServiceInvoicePage;
