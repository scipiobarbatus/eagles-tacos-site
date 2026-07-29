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

Without `EAGLES_INQUIRY_EMAIL`, the contact form returns a prefilled SMS fallback to the truck number.
