
export async function onRequestPost(context) {
  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json"
      }
    });

  try {
    const { request, env } = context;
    const body = await request.json();

    if (!env.SQUARE_ACCESS_TOKEN ||
        !env.SQUARE_LOCATION_ID) {
      return json({
        error: "Square configuration missing"
      }, 500);
    }

    if (!Array.isArray(body.items) ||
        body.items.length === 0) {
      return json({
        error: "Cart is empty"
      }, 400);
    }

    const lineItems = body.items.map(item => {
      const quantity = Number(item.qty);
      const unitPrice = Number(item.unitPrice);

      if (
        !item.name ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        !Number.isFinite(unitPrice) ||
        unitPrice < 0
      ) {
        throw new Error("Invalid cart item");
      }

      const details = [
        item.variant,
        ...(Array.isArray(item.addons)
          ? item.addons.map(addon =>
              typeof addon === "string"
                ? addon
                : addon.name || ""
            )
          : []),
        item.instructions
          ? `Kitchen: ${item.instructions}`
          : null
      ].filter(Boolean).join(" | ");

      return {
        name: String(item.name).slice(0, 512),
        quantity: String(quantity),
        base_price_money: {
          amount: Math.round(unitPrice * 100),
          currency: "AUD"
        },
        ...(details
          ? { note: details.slice(0, 500) }
          : {})
      };
    });

    if (body.orderType === "Delivery") {
      lineItems.push({
        name: "Delivery Fee",
        quantity: "1",
        base_price_money: {
          amount: 500,
          currency: "AUD"
        }
      });
    }

    const totalCents = lineItems.reduce(
      (total, item) =>
        total +
        item.base_price_money.amount *
          Number(item.quantity),
      0
    );

    if (
      !Number.isFinite(Number(body.totalAmount)) ||
      totalCents !==
        Math.round(Number(body.totalAmount) * 100)
    ) {
      return json({
        error: "Order total mismatch",
        calculatedTotal: totalCents / 100
      }, 400);
    }

    const response = await fetch(
      "https://connect.squareup.com/v2/online-checkout/payment-links",
      {
        method: "POST",
        headers: {
          "Square-Version": "2024-01-18",
          Authorization:
            `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          idempotency_key: crypto.randomUUID(),
          order: {
            location_id: env.SQUARE_LOCATION_ID,
            reference_id: crypto.randomUUID(),
            line_items: lineItems
          },
          payment_note: [
            "Crave House Kitchen",
            body.orderType || "Pickup",
            body.customerName || "Guest"
          ].join(" | ")
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return json({
        error: "Square checkout failed",
        details: data.errors || data
      }, response.status);
    }

    return json({
      url: data.payment_link.url,
      orderId: data.payment_link.order_id,
      totalAmount: totalCents / 100,
      currency: "AUD"
    });

  } catch (error) {
    console.error("Checkout error:", error);

    return json({
      error: error.message
    }, 500);
  }
}
