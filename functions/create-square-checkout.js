export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();

    const response = await fetch('https://connect.squareup.com/v2/online-checkout/payment-links', {
      method: 'POST',
      headers: {
        'Square-Version': '2024-01-18',
        'Authorization': `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        idempotency_key: crypto.randomUUID(),
        quick_pay: {
          name: `Crave House Order - ${body.customerName || 'Online Guest'} (${body.orderType})`,
          price_money: {
            amount: Math.round(body.totalAmount * 100),
            currency: 'AUD'
          },
          location_id: env.SQUARE_LOCATION_ID
        }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return new Response(JSON.stringify({ error: data }), { status: 500 });
    }

    return new Response(JSON.stringify({ url: data.payment_link.url }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
