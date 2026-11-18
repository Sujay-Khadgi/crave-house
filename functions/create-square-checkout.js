
export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();

    const items = body.items;

    if (!Array.isArray(items) || items.length === 0) {
      return new Response(
        JSON.stringify({ error: "Cart is empty" }),
        { status: 400 }
      );
    }

    const lineItems = items.map((item) => {
      const quantity = Number(item.quantity);
      const price = Number(item.price);

      if (
        !item.name ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        !Number.isFinite(price) ||
        price < 0
      ) {
        throw new Error("Invalid cart item");
      }

      return {
        name: String(item.name),
        quantity: String(quantity),
        base_price_money: {
          amount: Math.round(price * 100),
          currency: "AUD"
        },
        ...(item.note
          ? { note: String(item.note).slice(0, 500) }
          : {})
      };
    });

    const calculatedTotal = lineItems.reduce(
      (sum, item) =>
        sum +
        item.base_price_money.amount *
          Number(item.quantity),
      0
    );

    // Temporary consistency check.
    // Production prices must be verified server-side.
    if (
      !Number.isFinite(Number(body.totalAmount)) ||
      calculatedTotal !==
        Math.round(Number(body.totalAmount) * 100)
    ) {
      return new Response(
        JSON.stringify({
          error: "Order total does not match cart"
        }),
        { status: 400 }
      );
    }

    const response = await fetch(
      "https://connect.squareup.com/v2/online-checkout/payment-links",
      {
        method: "POST",
        headers: {
          "Square-Version": "2026-09-16",
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
          payment_note:
            `Crave House Kitchen | ` +
            `${body.orderType || "Online"} | ` +
            `${body.customerName || "Guest"}`
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: data }),
        {
          status: response.status,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    return new Response(
      JSON.stringify({
        url: data.payment_link.url,
        orderId: data.payment_link.order_id
      }),
      {
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }
}
