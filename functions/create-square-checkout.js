export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();

    // 1. Map frontend cart items into Square's line_items format
    const lineItems = (body.items || []).map(item => ({
      name: `${item.name}${item.variant ? ' (' + item.variant + ')' : ''}`,
      quantity: String(item.qty || 1),
      base_price_money: {
        amount: Math.round(item.unitPrice * 100), // Convert dollars to cents
        currency: 'AUD'
      },
      note: item.addons && item.addons.length > 0 ? `Addons: ${item.addons.join(', ')}` : (item.instructions || undefined)
    }));

    // 2. Add delivery fee as a separate line item if selected
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

    // 3. Send request to Square using `order` instead of `quick_pay`
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
            customerName: body.customerName || 'Online Guest',
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
```[file-tag: code-generated-file-357ae181-e234-4a46-81c4-123456789abc]

### What this code does differently:
1. **Maps Cart Array**: It loops through `body.items` (your burgers, pizzas with selected sizes, drinks, etc.) and converts them into Square's `line_items` schema.
2. **Attaches Notes/Addons**: If a customer selects add-ons or types kitchen instructions, they are included as notes attached to that specific line item.
3. **Pulls Itemized Summary**: Because it sends an `order` block with multiple `line_items`, Square's hosted checkout page will now dynamically list every individual product under the **Order summary** dropdown section instead of condensing everything into a single lump sum.
