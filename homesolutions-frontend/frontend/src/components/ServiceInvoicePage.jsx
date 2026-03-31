import React, { useState, useEffect } from 'react';
import { buildApiUrl, getAuthHeaders, getAuthToken } from '../api';
import { CardElement, Elements, useStripe, useElements } from '@stripe/react-stripe-js';

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

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

function PaymentFormContent({ invoiceId, totalAmount, onPaymentSuccess }) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [clientSecret, setClientSecret] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const token = getAuthToken();

  // Fetch payment intent on mount
  useEffect(() => {
    const fetchPaymentIntent = async () => {
      try {
        const response = await fetch(buildApiUrl(`/invoices/${invoiceId}/create-payment-intent`), {
          method: 'POST',
          headers: getAuthHeaders(),
        });

        if (!response.ok) {
          throw new Error('Failed to create payment intent');
        }

        const data = await response.json();
        setClientSecret(data.clientSecret);
      } catch (err) {
        setErrorMessage(err.message || 'Failed to initialize payment');
      }
    };

    if (token) {
      fetchPaymentIntent();
    }
  }, [invoiceId, token]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);
    setErrorMessage('');

    try {
      const cardElement = elements.getElement(CardElement);

      // Confirm the payment using the card element
      const result = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card: cardElement,
        },
      });

      if (result.error) {
        setErrorMessage(result.error.message);
      } else if (result.paymentIntent && result.paymentIntent.status === 'succeeded') {
        // Confirm payment on backend
        const confirmResponse = await fetch(buildApiUrl(`/invoices/${invoiceId}/confirm-payment`), {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ paymentIntentId: result.paymentIntent.id }),
        });

        if (!confirmResponse.ok) {
          throw new Error('Failed to confirm payment');
        }

        onPaymentSuccess('Payment successful! Invoice marked as paid.');
      }
    } catch (err) {
      setErrorMessage(err.message || 'Payment processing failed');
    } finally {
      setIsProcessing(false);
    }
  };

  if (!clientSecret) {
    return <div className="payment-loading">Initializing payment form...</div>;
  }

  return (
    <form onSubmit={handleSubmit} className="payment-form">
      <div className="form-group">
        <label htmlFor="card-element">Credit or debit card</label>
        <div className="card-element-wrapper">
          <CardElement
            id="card-element"
            options={{
              style: {
                base: {
                  fontSize: '15px',
                  color: '#0f6e8c',
                  '::placeholder': { color: '#dbe4ec' },
                },
                invalid: {
                  color: '#ef8354',
                },
              },
            }}
          />
        </div>
      </div>

      {errorMessage && <div className="error-message">{errorMessage}</div>}

      <button
        type="submit"
        disabled={!stripe || isProcessing}
        className="btn-p"
        style={{ marginTop: '16px', width: '100%' }}
      >
        {isProcessing ? 'Processing...' : `Pay ${money(totalAmount)}`}
      </button>
    </form>
  );
}

function ServiceInvoicePage({ invoiceRequest, onBackToProfile }) {
  const [paymentStatus, setPaymentStatus] = useState('pending');
  const [successMessage, setSuccessMessage] = useState('');
  const [stripePromise, setStripePromise] = useState(null);

  // Initialize Stripe dynamically
  useEffect(() => {
    const initializeStripe = async () => {
      const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || 'pk_test_publican';
      if (publishableKey) {
        try {
          const { loadStripe } = await import('@stripe/stripe-js');
          const stripe = await loadStripe(publishableKey);
          setStripePromise(stripe);
        } catch (err) {
          console.error('Failed to load Stripe:', err);
        }
      }
    };
    initializeStripe();
  }, []);

  // Check payment status
  useEffect(() => {
    if (invoiceRequest?.invoiceId) {
      fetch(buildApiUrl(`/invoices/${invoiceRequest.invoiceId}/payment-status`), {
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

        {!isPaid && stripePromise && (
          <Elements stripe={stripePromise}>
            <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid #dbe4ec' }}>
              <h4 style={{ marginBottom: '16px', fontSize: '16px', fontWeight: '600' }}>Payment Details</h4>
              <PaymentFormContent
                invoiceId={invoiceRequest.invoiceId}
                totalAmount={total}
                onPaymentSuccess={(msg) => {
                  setSuccessMessage(msg);
                  setPaymentStatus('completed');
                  setTimeout(() => setSuccessMessage(''), 3000);
                }}
              />
            </div>
          </Elements>
        )}

        <button type="button" className="btn-p" style={{ marginTop: '24px' }} onClick={onBackToProfile}>
          Back to Service Provider Profile
        </button>
      </div>
    </section>
  );
}

export default ServiceInvoicePage;
