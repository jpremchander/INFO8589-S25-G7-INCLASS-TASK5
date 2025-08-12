import { loadScript } from 'https://cdn.jsdelivr.net/npm/@paypal/paypal-js@8.1.2/+esm';
class Year extends HTMLElement {
  connectedCallback() {
    this.innerHTML = new Date().getFullYear();
  }
}
customElements.define('x-date', Year);

class PayPal extends HTMLElement {
  static observedAttributes = ['amount', 'currency'];

  constructor() {
    super();
  }
  async connectedCallback() {
    const tracer = globalThis.__otelTracer ? globalThis.__otelTracer() : null;
    const amount = this.getAttribute('amount');
    const currency = this.getAttribute('currency') || 'USD';
    const rootSpan = tracer?.startSpan('paypal.componentInit', {
      attributes: { 'paypal.amount': amount, 'paypal.currency': currency },
    });
    this.innerHTML = `
      <div id="paypal-button-container"></div>
      <p id="result-message"></p>
    `;
  // Fetch client id
  let clientId = '';
  try {
  const res = await fetch('clientid');
  const oClient = await res.json();
  clientId = oClient.clientid || '';
    } catch (e) {
      console.error('Failed to fetch clientid', e);
      rootSpan?.recordException(e);
      rootSpan?.setAttribute('error', true);
    }
  // Load PayPal SDK
  let paypal;
  try {
      paypal = await loadScript({ clientId, currency });
      paypal.resultMessage = (msg) => {
        const el = document.querySelector('#result-message');
        if (el) el.innerHTML = msg;
      };
    } catch (e) {
      console.error('failed to load the PayPal JS SDK script', e);
      rootSpan?.recordException(e);
      rootSpan?.setAttribute('error', true);
      try {
        fetch('ui/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ level: 'error', message: 'failed to load PayPal JS SDK', extra: { error: String(e) } }),
        });
      } catch {}
    } finally {
      rootSpan?.end();
    }
    if (!paypal) return;

    try {
      await paypal
        .Buttons({
          style: { shape: 'rect', layout: 'vertical', color: 'gold', label: 'paypal' },
          message: { amount },
          async createOrder() {
            const span = tracer?.startSpan('paypal.createOrder', {
              attributes: { 'paypal.amount': amount, 'paypal.currency': currency },
            });
            try {
              const response = await fetch('orders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  cart: [{ id: 'YOUR_PRODUCT_ID', quantity: 'YOUR_PRODUCT_QUANTITY', amount, currency }],
                }),
              });
              const orderData = await response.json();
              if (orderData.id) {
                try {
                  fetch('ui/metric', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: 'orders.created', value: 1, attrs: { currency } }),
                  });
                } catch {}
                return orderData.id;
              }
              const errorDetail = orderData?.details?.[0];
              const errorMessage = errorDetail
                ? `${errorDetail.issue} ${errorDetail.description} (${orderData.debug_id})`
                : JSON.stringify(orderData);
              throw new Error(errorMessage);
            } catch (error) {
              console.error(error);
              paypal.resultMessage(`Could not initiate PayPal Checkout...<br><br>${error}`);
              span?.recordException(error);
              span?.setAttribute('error', true);
              try {
                fetch('ui/log', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ level: 'error', message: 'createOrder failed', extra: { error: String(error) } }),
                });
              } catch {}
            } finally {
              span?.end();
            }
          },
          async onApprove(data, actions) {
            const span = tracer?.startSpan('paypal.onApprove');
            try {
              const response = await fetch(`capture/${data.orderID}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
              });
              const orderData = await response.json();
              const errorDetail = orderData?.details?.[0];
              if (errorDetail?.issue === 'INSTRUMENT_DECLINED') {
                try {
                  fetch('ui/log', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ level: 'warn', message: 'INSTRUMENT_DECLINED - restarting' }),
                  });
                } catch {}
                return actions.restart();
              } else if (errorDetail) {
                throw new Error(`${errorDetail.description} (${orderData.debug_id})`);
              } else if (!orderData.purchase_units) {
                throw new Error(JSON.stringify(orderData));
              } else {
                const tx =
                  orderData?.purchase_units?.[0]?.payments?.captures?.[0] ||
                  orderData?.purchase_units?.[0]?.payments?.authorizations?.[0];
                span?.setAttribute('transaction.status', tx?.status || 'unknown');
                span?.setAttribute('transaction.id', tx?.id || '');
                try {
                  fetch('ui/metric', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: 'orders.captured', value: 1 }),
                  });
                } catch {}
                paypal.resultMessage(`Transaction ${tx.status}: ${tx.id}<br><br>See console for all available details`);
                console.log('Capture result', orderData, JSON.stringify(orderData, null, 2));
              }
            } catch (error) {
              console.error(error);
              paypal.resultMessage(`Sorry, your transaction could not be processed...<br><br>${error}`);
              span?.recordException(error);
              span?.setAttribute('error', true);
            } finally {
              span?.end();
            }
          },
        })
        .render('#paypal-button-container');
      try {
        fetch('ui/metric', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'button.rendered', value: 1 }),
        });
      } catch {}
    } catch (e) {
      console.error('failed to render the PayPal Buttons', e);
    }
  }
}
customElements.define('x-paypal', PayPal);
import { loadScript } from 'https://cdn.jsdelivr.net/npm/@paypal/paypal-js@8.1.2/+esm';

class Year extends HTMLElement {
  connectedCallback() {
    this.innerHTML = new Date().getFullYear();
  }
}
customElements.define('x-date', Year);

class PayPal extends HTMLElement {
  static observedAttributes = ['amount', 'currency'];

  constructor() {
    super();
  }

  async connectedCallback() {
    const tracer = globalThis.__otelTracer ? globalThis.__otelTracer() : null;
    const amount = this.getAttribute('amount');
    const currency = this.getAttribute('currency') || 'USD';
    const base = (path) => path; // relative to same-origin server

    this.innerHTML = `
      <div id="paypal-button-container"></div>
      <p id="result-message"></p>
    `;

    const rootSpan = tracer?.startSpan('paypal.componentInit', {
      attributes: { 'paypal.amount': amount, 'paypal.currency': currency },
    });

    // Fetch client id
    let clientId = '';
    try {
      const res = await fetch(base('clientid'));
      const oClient = await res.json();
      clientId = oClient.clientid || '';
    } catch (e) {
      console.error('Failed to fetch clientid', e);
      rootSpan?.recordException(e);
      rootSpan?.setAttribute('error', true);
    }

    // Load PayPal SDK
    let paypal;
    try {
      paypal = await loadScript({ clientId, currency });
      paypal.resultMessage = (msg) => {
        const el = document.querySelector('#result-message');
        if (el) el.innerHTML = msg;
      };
    } catch (e) {
      console.error('failed to load the PayPal JS SDK script', e);
      rootSpan?.recordException(e);
      rootSpan?.setAttribute('error', true);
      try {
        fetch(base('ui/log'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ level: 'error', message: 'failed to load PayPal JS SDK', extra: { error: String(e) } }),
        });
      } catch {}
    } finally {
      rootSpan?.end();
    }

    if (!paypal) return;

    try {
      await paypal
        .Buttons({
          style: { shape: 'rect', layout: 'vertical', color: 'gold', label: 'paypal' },
          message: { amount },
          async createOrder() {
            const span = tracer?.startSpan('paypal.createOrder', {
              attributes: { 'paypal.amount': amount, 'paypal.currency': currency },
            });
            try {
              const response = await fetch(base('orders'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  cart: [{ id: 'YOUR_PRODUCT_ID', quantity: 'YOUR_PRODUCT_QUANTITY', amount, currency }],
                }),
              });
              const orderData = await response.json();
              if (orderData.id) {
                try {
                  fetch(base('ui/metric'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: 'orders.created', value: 1, attrs: { currency } }),
                  });
                } catch {}
                return orderData.id;
              }
              const errorDetail = orderData?.details?.[0];
              const errorMessage = errorDetail
                ? `${errorDetail.issue} ${errorDetail.description} (${orderData.debug_id})`
                : JSON.stringify(orderData);
              throw new Error(errorMessage);
            } catch (error) {
              console.error(error);
              paypal.resultMessage(`Could not initiate PayPal Checkout...\n\n${error}`);
              span?.recordException(error);
              span?.setAttribute('error', true);
              try {
                fetch(base('ui/log'), {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ level: 'error', message: 'createOrder failed', extra: { error: String(error) } }),
                });
              } catch {}
            } finally {
              span?.end();
            }
          },
          async onApprove(data, actions) {
            const span = tracer?.startSpan('paypal.onApprove');
            try {
              const response = await fetch(base(`capture/${data.orderID}`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
              });
              const orderData = await response.json();
              const errorDetail = orderData?.details?.[0];
              if (errorDetail?.issue === 'INSTRUMENT_DECLINED') {
                try {
                  fetch(base('ui/log'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ level: 'warn', message: 'INSTRUMENT_DECLINED - restarting' }),
                  });
                } catch {}
                return actions.restart();
              } else if (errorDetail) {
                throw new Error(`${errorDetail.description} (${orderData.debug_id})`);
              } else if (!orderData.purchase_units) {
                throw new Error(JSON.stringify(orderData));
              } else {
                const tx =
                  orderData?.purchase_units?.[0]?.payments?.captures?.[0] ||
                  orderData?.purchase_units?.[0]?.payments?.authorizations?.[0];
                span?.setAttribute('transaction.status', tx?.status || 'unknown');
                span?.setAttribute('transaction.id', tx?.id || '');
                try {
                  fetch(base('ui/metric'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: 'orders.captured', value: 1 }),
                  });
                } catch {}
                paypal.resultMessage(`Transaction ${tx.status}: ${tx.id}<br><br>See console for all available details`);
                console.log('Capture result', orderData, JSON.stringify(orderData, null, 2));
              }
            } catch (error) {
              console.error(error);
              paypal.resultMessage(`Sorry, your transaction could not be processed...\n\n${error}`);
              span?.recordException(error);
              span?.setAttribute('error', true);
            } finally {
              span?.end();
            }
          },
        })
        .render('#paypal-button-container');
      try {
        fetch(base('ui/metric'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'button.rendered', value: 1 }),
        });
      } catch {}
    } catch (e) {
      console.error('failed to render the PayPal Buttons', e);
    }
  }
}

customElements.define('x-paypal', PayPal);