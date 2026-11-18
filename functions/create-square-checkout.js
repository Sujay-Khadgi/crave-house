export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();

    // Map cart items into Square's required line_items format for order summary display
    const lineItems = (body.items || []).map(item => ({
      name: `${item.name}${item.variant ? ' (' + item.variant + ')' : ''}`,
      quantity: String(item.qty || 1),
      item_type: 'ITEM',
      base_price_money: {
        amount: Math.round(item.unitPrice * 100), // Convert dollars to cents integer
        currency: 'AUD'
      },
      note: item.addons && item.addons.length > 0 ? `Addons: ${item.addons.join(', ')}` : (item.instructions || undefined)
    }));

    // Add delivery fee if applicable
    if (body.orderType === 'Delivery') {
      lineItems.push({
        name: 'Delivery Fee',
        quantity: '1',
        item_type: 'ITEM',
        base_price_money: {
          amount: 500,
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
      console.error("Square API Error:", JSON.stringify(data));
      return new Response(JSON.stringify({ error: data }), { status: 500 });
    }

    return new Response(JSON.stringify({ url: data.payment_link.url }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error("Worker Error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
```[file-tag: code-generated-file-991ae23b-1234-4ef8-89ab-cdef01234567]

### Step 3: Trigger a Fresh Deployment
1. Commit and push this file to your GitHub repository (or redeploy manually via your Cloudflare Pages dashboard).
2. Wait 30–60 seconds for Cloudflare to build and deploy the updated functions bundle.
3. Refresh your website (`crave-house.pages.dev`), add items to your cart, and test online checkout again.

<ElicitationsGroup message="If you run into build issues or need help checking your setup:">
  <Elicitation label="Where do I place the folder?" query="Where exactly should the functions folder be placed in my project repository?"/>
  <Elicitation label="Check environment variables" query="How do I verify that my Square access token is configured correctly in Cloudflare?"/>
</ElicitationsGroup>
