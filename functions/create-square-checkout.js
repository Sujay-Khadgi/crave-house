
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
        error: "Square environment variables missing"
      }, 500);
    }

    if (!Array.isArray(body.items) ||
        body.items.length === 0) {
      return json({ error: "Cart is empty" }, 400);
    }

    const lineItems = body.items.map(item => {
      const qty = Number(item.qty);
      const price = Number(item.unitPrice);

      if (!item.name ||
          !Number.isInteger(qty) ||
          qty < 1 ||
          !Number.isFinite(price) ||
          price < 0) {
        throw new Error("Invalid cart item");
      }

      const details = [
        item.variant,
        ...(Array.isArray(item.addons)
          ? item.addons
          : []),
        item.instructions
          ? `Kitchen: ${item.instructions}`
          : null
      ].filter(Boolean).join(" | ");

      return {
        name: String(item.name).slice(0, 512),
        quantity: String(qty),
        base_price_money: {
          amount: Math.round(price * 100),
          currency: "AUD"
        },
        ...(details
          ? { note: details.slice(0, 500) }
          : {})
      };
    });

    const deliveryFee =
      body.orderType === "Delivery" ? 500 : 0;

    if (deliveryFee > 0) {
      lineItems.push({
        name: "Delivery Fee",
        quantity: "1",
        base_price_money: {
          amount: deliveryFee,
          currency: "AUD"
        }
      });
    }

    const totalCents = lineItems.reduce(
      (sum, item) =>
        sum +
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
        error: "Cart total mismatch",
        calculatedTotal: totalCents / 100
      }, 400);
    }

    const orderNotes = [
      `Customer: ${body.customerName || "Guest"}`,
      `Phone: ${body.customerPhone || "Not provided"}`,
      `Type: ${body.orderType || "Pickup"}`,
      body.orderType === "Delivery"
        ? `Address: ${body.customerAddress || ""}`
        : null,
      body.orderNotes
        ? `Notes: ${body.orderNotes}`
        : null
    ].filter(Boolean).join(" | ");

    const response = await fetch(
      "https://connect.squareup.com/v2/online-checkout/payment-links",
      {
        method: "POST",
        headers: {
          "Square-Version": "2024-01-18",
          "Authorization":
            `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          idempotency_key: crypto.randomUUID(),
          order: {
            location_id: env.SQUARE_LOCATION_ID,
            reference_id: crypto.randomUUID(),
            line_items: lineItems,
            metadata: {
              order_type: String(
                body.orderType || "Pickup"
              ),
              customer_name: String(
                body.customerName || "Guest"
              ).slice(0, 255)
            }
          },
          payment_note: orderNotes.slice(0, 500)
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error(
        "Square checkout error:",
        JSON.stringify(data)
      );

      return json({
        error: "Square checkout failed",
        details: data.errors || data
      }, response.status);
    }

    return json({
      url: data.payment_link.url,
      orderId: data.payment_link.order_id
    });

  } catch (err) {
    console.error("Checkout error:", err);
    return json({
      error: err.message
    }, 500);
  }
}
