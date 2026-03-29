import React from 'react';

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

function ServiceInvoicePage({ invoiceRequest, onBackToProfile }) {
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

  return (
    <section className="section-wrap invoice-wrap">
      <div className="sec-label">Invoice</div>
      <div className="card invoice-card">
        <p className="invoice-title">Service Invoice</p>

        <p className="history-line"><strong>RequestID:</strong> {invoiceRequest.requestId}</p>
        <p className="history-line"><strong>Request Date:</strong> {requestDateTime.date}</p>
        <p className="history-line"><strong>Request Time:</strong> {requestDateTime.time}</p>
        <p className="history-line"><strong>Completion Date:</strong> {completionDateTime.date}</p>
        <p className="history-line"><strong>Completion Time:</strong> {completionDateTime.time}</p>
        <p className="history-line"><strong>Base Rate X Hours Worked:</strong> {money(baseRatePerHour)} x {hoursWorked} = {money(laborCost)}</p>
        <p className="history-line"><strong>Cost of Extra Materials Used:</strong> {money(materialCost)}</p>
        <p className="history-line"><strong>Extra Fee (Urgent Optional):</strong> {money(urgentExtraFee)}</p>
        <p className="history-line"><strong>Subtotal:</strong> {money(subtotal)}</p>
        <p className="history-line"><strong>Tax 7%:</strong> {money(tax)}</p>
        <p className="history-line"><strong>Commission 5%:</strong> {money(commission)}</p>
        <p className="history-line invoice-total"><strong>Total:</strong> {money(total)}</p>

        <button type="button" className="btn-p" style={{ marginTop: '12px' }} onClick={onBackToProfile}>
          Back to Service Provider Profile
        </button>
      </div>
    </section>
  );
}

export default ServiceInvoicePage;
