const https = require('https');

exports.handler = async function(event, context) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        const orderData = JSON.parse(event.body);
        const accessToken = process.env.SQUARE_ACCESS_TOKEN;
        const locationId = process.env.SQUARE_LOCATION_ID;

        if (!accessToken || !locationId) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'Missing SQUARE_ACCESS_TOKEN or SQUARE_LOCATION_ID in Netlify environment variables.' })
            };
        }

        const totalAmountCents = Math.round(orderData.total * 100);

        const squarePayload = JSON.stringify({
            idempotency_key: 'ch-' + Date.now() + '-' + Math.random().toString(36.substring(2, 9)),
            quick_pay: {
                name: `Crave House Order (${orderData.fulfillment.toUpperCase()})`,
                price_money: {
                    amount: totalAmountCents,
                    currency: 'AUD'
                },
                location_id: locationId
            },
            payment_note: `Customer: ${orderData.customer.name} | Phone: ${orderData.customer.phone} | Items: ${orderData.items.length}`
        });

        const options = {
            hostname: 'connect.squareup.com',
            port: 443,
            path: '/v2/online-checkout/payment-links',
            method: 'POST',
            headers: {
                'Square-Version': '2026-09-16',
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(squarePayload)
            }
        };

        const result = await new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
                    } catch (e) {
                        reject(new Error('Invalid JSON response from Square'));
                    }
                });
            });
            req.on('error', (err) => reject(err));
            req.write(squarePayload);
            req.end();
        });

        if (result.statusCode >= 200 && result.statusCode < 300 && result.body.payment_link) {
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: result.body.payment_link.url })
            };
        } else {
            console.error('Square Error:', JSON.stringify(result.body));
            return {
                statusCode: 400,
                body: JSON.stringify({ error: result.body.errors ? result.body.errors[0].detail : 'Failed to create Square checkout link' })
            };
        }
    } catch (err) {
        console.error('Function Exception:', err);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: err.message })
        };
    }
};