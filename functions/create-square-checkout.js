export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();

    // Map frontend cart items into Square's line_items format
    const lineItems = (body.items || []).map(item => ({
      name: `${item.name}${item.variant ? ' (' + item.variant + ')' : ''}`,
      quantity: String(item.qty || 1),
      base_price_money: {
        amount: Math.round(item.unitPrice * 100), // Convert dollars to cents
        currency: 'AUD'
      },
      note: item.addons && item.addons.length > 0 ? `Addons: ${item.addons.join(', ')}` : (item.instructions || undefined)
    }));

    // Add delivery fee as a separate line item if selected
    if (body.orderType === 'Delivery') {
      lineItems.push({
        name: 'Delivery Fee',
        quantity: '1',
        base_price_money: {
          amount: 500, // $5.00 in cents
          currency: 'AUD'
        }
      });
    }

    const response = await fetch('https://connect.squareup.com/v2/online-checkout/payment-links', {
      method: 'POST',
      headers: {
        'Square-Version': '2024-01-18',
        'Authorization': `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        idempotency_key: crypto.randomUUID(),
        order: {
          location_id: env.SQUARE_LOCATION_ID,
          line_items: lineItems,
          metadata: {
            customerName: body.customerName || 'Guest',
            customerPhone: body.customerPhone || '',
            orderType: body.orderType || 'Pickup',
            deliveryAddress: body.customerAddress || ''
          }
        },
        checkout_options: {
          redirect_url: 'https://' + new URL(request.url).host + '/index.html?success=true'
        }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Square API Error Response:", JSON.stringify(data));
      return new Response(JSON.stringify({ error: data }), { status: 500 });
    }

    return new Response(JSON.stringify({ url: data.payment_link.url }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
