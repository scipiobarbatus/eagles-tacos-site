# Eagles Tacos Site

Static Eagles Tacos site served by a Cloudflare Worker.

## Deploy

```bash
npm install
npm run deploy
```

Cloudflare deploys `public/` as static assets and runs `src/worker.js` for `/api/*`.

## Runtime

- `EAGLES_OWNER_PIN`: optional secret for `/owner` location updates.
- `EAGLES_LOCATION_KV`: optional KV binding for durable location and inquiry storage.
- `EAGLES_INQUIRY_EMAIL`: optional Cloudflare Email Service send binding.
- `EAGLES_INQUIRY_TO`: optional recipient override. Defaults to `theeaglestacos@gmail.com`.

The contact form sends from `inquiries@eaglestacos.com` to `theeaglestacos@gmail.com`.
Cloudflare Email Service requires the sender domain and destination address to be verified. Without
`EAGLES_INQUIRY_EMAIL`, the contact form returns a prefilled SMS fallback to the truck number.

The Worker also has an inbound `email()` handler for Cloudflare Email Routing. To forward mail
sent to an Eagles Tacos address, add an Email Routing rule in Cloudflare that sends the address
or catch-all pattern to the `eagles-tacos` Worker. The Worker forwards routed mail to
`theeaglestacos@gmail.com`, which must be a verified destination address.
