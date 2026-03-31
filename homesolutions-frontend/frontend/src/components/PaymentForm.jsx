import React, { useState, useEffect } from 'react';
import { loadStripe } from '@stripe/js';
import { CardElement, Elements, useStripe, useElements } from '@stripe/react-stripe-js';
import { buildApiUrl } from '../api';

let stripePromise;

const getStripe = async () => {
  if (!stripePromise) {
    const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || 'pk_test_51234567890';
    stripePromise = loadStripe(publishableKey);
  }
  return stripePromise;
};

function PaymentFormContent({ invoiceId, totalAmount, onPaymentSuccess, onPaymentError }) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [clientSecret, setClientSecret] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');

  // Fetch payment intent on mount
  useEffect(() => {
    const fetchPaymentIntent = async () => {
      try {
        const response = await fetch(buildApiUrl(`/invoices/${invoiceId}/create-payment-intent`), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('authToken')}`,
          },
        });

        if (!response.ok) {
          throw new Error('Failed to create payment intent');
        }

        const data = await response.json();
        setClientSecret(data.clientSecret);
      } catch (err) {
        setErrorMessage(err.message || 'Failed to initialize payment');
        onPaymentError(err.message);
      }
    };

    fetchPaymentIntent();
  }, [invoiceId, onPaymentError]);

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
        onPaymentError(result.error.message);
      } else if (result.paymentIntent && result.paymentIntent.status === 'succeeded') {
        // Confirm payment on backend
        const confirmResponse = await fetch(buildApiUrl(`/invoices/${invoiceId}/confirm-payment`), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('authToken')}`,
          },
          body: JSON.stringify({ paymentIntentId: result.paymentIntent.id }),
        });

        if (!confirmResponse.ok) {
          throw new Error('Failed to confirm payment');
        }

        onPaymentSuccess('Payment successful! Invoice marked as paid.');
      }
    } catch (err) {
      setErrorMessage(err.message || 'Payment processing failed');
      onPaymentError(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!clientSecret) {
    return <div className="payment-loading">Setting up payment form...</div>;
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

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

export async function PaymentForm({ invoiceId, totalAmount, onPaymentSuccess, onPaymentError }) {
  const stripePromise = await getStripe();

  if (!stripePromise) {
    return (
      <div className="error-message">
        Stripe is not available. Please check your VITE_STRIPE_PUBLISHABLE_KEY environment variable.
      </div>
    );
  }

  return (
    <Elements stripe={stripePromise}>
      <PaymentFormContent
        invoiceId={invoiceId}
        totalAmount={totalAmount}
        onPaymentSuccess={onPaymentSuccess}
        onPaymentError={onPaymentError}
      />
    </Elements>
  );
}

export default PaymentForm;
