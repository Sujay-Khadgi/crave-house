export async function onRequestPost({ request, env }) {
  const reply = (payload, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });

  try {
    if (!env.SQUARE_ACCESS_TOKEN || !env.SQUARE_LOCATION_ID) {
      console.error('Missing Square environment variables');
      return reply({ error: 'Payment service is not configured.' }, 500);
    }

    const body = await request.json();
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > 100) {
      return reply({ error: 'Invalid or empty cart.' }, 400);
    }
    if (!['Pickup', 'Delivery'].includes(body.orderType)) {
      return reply({ error: 'Invalid order type.' }, 400);
    }

    const line_items = body.items.map(item => {
      const quantity = Number(item.qty);
      const unitPrice = Number(item.unitPrice);
      if (typeof item.name !== 'string' || !item.name.trim() ||
          !Number.isInteger(quantity) || quantity < 1 || quantity > 100 ||
          !Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 10000) {
        throw new Error('Invalid cart item.');
      }
      const details = [
        item.variant ? `Option: ${String(item.variant)}` : '',
        ...(Array.isArray(item.addons) ? item.addons.map(a => `Extra: ${String(a)}`) : []),
        item.instructions ? `Kitchen: ${String(item.instructions)}` : ''
      ].filter(Boolean).join(' | ');
      return {
        name: item.name.trim().slice(0, 512),
        quantity: String(quantity),
        base_price_money: { amount: Math.round(unitPrice * 100), currency: 'AUD' },
        ...(details ? { note: details.slice(0, 500) } : {})
      };
    });

    if (body.orderType === 'Delivery') {
      if (!String(body.customerAddress || '').trim()) {
        return reply({ error: 'Delivery address is required.' }, 400);
      }
      line_items.push({
        name: 'Delivery Fee',
        quantity: '1',
        base_price_money: { amount: 500, currency: 'AUD' }
      });
    }

    const expectedCents = line_items.reduce((sum, item) =>
      sum + item.base_price_money.amount * Number(item.quantity), 0);
    const claimedTotal = Number(body.totalAmount);
    if (!Number.isFinite(claimedTotal) || Math.round(claimedTotal * 100) !== expectedCents) {
      return reply({ error: 'Cart total mismatch. Please refresh and try again.' }, 400);
    }

    const paymentNote = [
      `Customer: ${String(body.customerName || 'Guest')}`,
      `Phone: ${String(body.customerPhone || '')}`,
      `Type: ${body.orderType}`,
      body.orderType === 'Delivery' ? `Address: ${String(body.customerAddress)}` : '',
      body.orderNotes ? `Notes: ${String(body.orderNotes)}` : ''
    ].filter(Boolean).join(' | ').slice(0, 500);

    const squareResponse = await fetch('https://connect.squareup.com/v2/online-checkout/payment-links', {
      method: 'POST',
      headers: {
        'Square-Version': '2024-01-18',
        Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        idempotency_key: crypto.randomUUID(),
        order: {
          location_id: env.SQUARE_LOCATION_ID,
          reference_id: crypto.randomUUID(),
          line_items
        },
        payment_note: paymentNote
      })
    });

    const squareData = await squareResponse.json();
    if (!squareResponse.ok || !squareData.payment_link?.url) {
      console.error('Square payment link error', JSON.stringify(squareData));
      return reply({
        error: 'Square could not create the payment link.',
        details: squareData.errors || []
      }, 502);
    }

    return reply({
      url: squareData.payment_link.url,
      orderId: squareData.payment_link.order_id
    });
  } catch (error) {
    console.error('Checkout function failed:', error);
    return reply({ error: error.message || 'Unexpected checkout error.' }, 500);
  }
}
