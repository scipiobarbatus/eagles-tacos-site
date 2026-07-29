const LOCATION_KEY = "eagles-tacos:current-location";
const INQUIRY_INDEX_KEY = "eagles-tacos:recent-inquiries";
const PHONE_NUMBER = "+13234044000";
const PHONE_DISPLAY = "(323) 404-4000";
const INQUIRY_EMAIL_FROM = "inquiries@eaglestacos.com";
const INQUIRY_EMAIL_TO = "theeaglestacos@gmail.com";

const DEFAULT_LOCATION = {
  label: "Eagles Tacos",
  address: "1930 Colorado Blvd, Los Angeles, CA 90041",
  hours: "Check today's hours before you roll through.",
  status: "Serving Eagle Rock",
  note: "Call ahead for fast pick-up or book the truck for private events.",
  mapsUrl:
    "https://www.google.com/maps/search/?api=1&query=1930%20Colorado%20Blvd%2C%20Los%20Angeles%2C%20CA%2090041",
  orderUrl: `tel:${PHONE_NUMBER}`,
  updatedAt: null,
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/location") {
      return handleLocationApi(request, env);
    }

    if (url.pathname === "/api/inquiry") {
      return handleInquiryApi(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleLocationApi(request, env) {
  if (request.method === "GET") {
    return jsonResponse({ location: await readLocation(env) });
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { allow: "GET, POST, OPTIONS" } });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const configuredPin = typeof env.EAGLES_OWNER_PIN === "string" ? env.EAGLES_OWNER_PIN : "";
  const isLocal = new URL(request.url).hostname === "127.0.0.1" || new URL(request.url).hostname === "localhost";
  const expectedPin = configuredPin || (isLocal ? "eagles" : "");

  if (!expectedPin) {
    return jsonResponse(
      { error: "Location updates need EAGLES_OWNER_PIN configured before deployment." },
      { status: 503 },
    );
  }

  if (request.headers.get("x-owner-pin") !== expectedPin) {
    return jsonResponse({ error: "Wrong owner PIN." }, { status: 401 });
  }

  const payload = await readJson(request);
  if (!payload) {
    return jsonResponse({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const location = normalizeLocation(payload);
  await writeLocation(env, location);
  return jsonResponse({ location });
}

async function handleInquiryApi(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { allow: "POST, OPTIONS" } });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  const payload = await readJson(request);
  if (!payload) {
    return jsonResponse({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const inquiry = normalizeInquiry(payload);
  const fallbackHref = smsHrefForInquiry(inquiry);

  if (!inquiry.name || !inquiry.email || !inquiry.eventType) {
    return jsonResponse(
      { error: "Name, email, and event type are required.", fallbackHref },
      { status: 400 },
    );
  }

  await saveInquiry(env, inquiry);

  const inquiryEmailTo = getInquiryEmailTo(env);
  if (!hasEmailBinding(env) || !inquiryEmailTo) {
    return jsonResponse({
      ok: false,
      error: `Inquiry saved. To notify the truck immediately, text ${PHONE_DISPLAY}.`,
      fallbackHref,
    });
  }

  try {
    await env.EAGLES_INQUIRY_EMAIL.send({
      to: inquiryEmailTo,
      from: { email: INQUIRY_EMAIL_FROM, name: "Eagles Tacos Website" },
      replyTo: { email: inquiry.email, name: inquiry.name },
      subject: inquiryEmailSubject(inquiry),
      text: inquiryEmailText(inquiry),
      html: inquiryEmailHtml(inquiry),
    });
  } catch (error) {
    console.error("Inquiry email failed", error);
    return jsonResponse(
      {
        ok: false,
        error: `Inquiry saved. Email delivery is not ready yet; text ${PHONE_DISPLAY}.`,
        fallbackHref,
      },
      { status: 502 },
    );
  }

  return jsonResponse({ ok: true, message: "Inquiry sent. Eagles Tacos will follow up.", fallbackHref });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function jsonResponse(payload, init) {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...init?.headers,
    },
  });
}

function getKv(env) {
  const kv = env.EAGLES_LOCATION_KV;
  return kv && typeof kv.get === "function" && typeof kv.put === "function" ? kv : undefined;
}

async function readLocation(env) {
  const kv = getKv(env);
  if (!kv) return DEFAULT_LOCATION;

  const stored = await kv.get(LOCATION_KEY);
  if (!stored) return DEFAULT_LOCATION;

  try {
    return { ...DEFAULT_LOCATION, ...JSON.parse(stored) };
  } catch {
    return DEFAULT_LOCATION;
  }
}

async function writeLocation(env, location) {
  const kv = getKv(env);
  if (!kv) return;
  await kv.put(LOCATION_KEY, JSON.stringify(location));
}

function normalizeLocation(payload) {
  const address = cleanText(payload.address, 180) || DEFAULT_LOCATION.address;

  return {
    label: cleanText(payload.label, 70) || DEFAULT_LOCATION.label,
    address,
    hours: cleanText(payload.hours, 90) || DEFAULT_LOCATION.hours,
    status: cleanText(payload.status, 90) || DEFAULT_LOCATION.status,
    note: cleanText(payload.note, 220) || DEFAULT_LOCATION.note,
    mapsUrl: cleanUrl(payload.mapsUrl) || mapsUrlFor(address),
    orderUrl: cleanUrl(payload.orderUrl) || DEFAULT_LOCATION.orderUrl,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeInquiry(payload) {
  return {
    name: cleanText(payload.name, 90),
    email: cleanText(payload.email, 120),
    phone: cleanText(payload.phone, 40),
    eventType: cleanText(payload.eventType, 80),
    date: cleanText(payload.date, 40),
    time: cleanText(payload.time, 80),
    guests: cleanText(payload.guests, 30),
    location: cleanText(payload.location, 180),
    notes: cleanText(payload.notes, 800),
    submittedAt: new Date().toISOString(),
    source: "Eagles Tacos website",
  };
}

async function saveInquiry(env, inquiry) {
  const kv = getKv(env);
  if (!kv) return;

  const id = `${Date.now()}-${crypto.randomUUID()}`;
  const record = { id, ...inquiry };
  await kv.put(`eagles-tacos:inquiry:${id}`, JSON.stringify(record));

  let recent = [];
  const stored = await kv.get(INQUIRY_INDEX_KEY);
  if (stored) {
    try {
      recent = JSON.parse(stored);
    } catch {
      recent = [];
    }
  }

  recent = [record, ...recent].slice(0, 25);
  await kv.put(INQUIRY_INDEX_KEY, JSON.stringify(recent));
}

function hasEmailBinding(env) {
  return env.EAGLES_INQUIRY_EMAIL && typeof env.EAGLES_INQUIRY_EMAIL.send === "function";
}

function getInquiryEmailTo(env) {
  return typeof env.EAGLES_INQUIRY_TO === "string" && env.EAGLES_INQUIRY_TO.trim()
    ? env.EAGLES_INQUIRY_TO.trim()
    : INQUIRY_EMAIL_TO;
}

function smsHrefForInquiry(inquiry) {
  const body = [
    "Hi Eagles Tacos, I'm interested in booking the truck.",
    "",
    `Name: ${inquiry.name}`,
    `Email: ${inquiry.email}`,
    `Phone: ${inquiry.phone}`,
    `Event type: ${inquiry.eventType}`,
    `Date: ${inquiry.date}`,
    `Time: ${inquiry.time}`,
    `Guests: ${inquiry.guests}`,
    `Location: ${inquiry.location}`,
    "",
    `Notes: ${inquiry.notes || "N/A"}`,
  ].join("\n");

  return `sms:${PHONE_NUMBER}?body=${encodeURIComponent(body)}`;
}

function inquiryEmailSubject(inquiry) {
  return `New Eagles Tacos ${inquiry.eventType || "event"} inquiry from ${
    inquiry.name || "website visitor"
  }`.slice(0, 140);
}

function inquiryDetails(inquiry) {
  return [
    ["Name", inquiry.name],
    ["Email", inquiry.email],
    ["Phone", inquiry.phone || "N/A"],
    ["Event type", inquiry.eventType],
    ["Date", inquiry.date || "N/A"],
    ["Time", inquiry.time || "N/A"],
    ["Guest count", inquiry.guests || "N/A"],
    ["Event location", inquiry.location || "N/A"],
    ["Submitted", inquiry.submittedAt],
    ["Source", inquiry.source],
  ];
}

function inquiryEmailText(inquiry) {
  return [
    "New Eagles Tacos inquiry",
    "",
    ...inquiryDetails(inquiry).map(([label, value]) => `${label}: ${value}`),
    "",
    "Notes:",
    inquiry.notes || "N/A",
  ].join("\n");
}

function inquiryEmailHtml(inquiry) {
  const rows = inquiryDetails(inquiry)
    .map(
      ([label, value]) =>
        `<tr><th align="left" style="padding:6px 12px 6px 0">${escapeHtml(
          label,
        )}</th><td style="padding:6px 0">${escapeHtml(value)}</td></tr>`,
    )
    .join("");

  return `<!doctype html>
<html>
  <body style="font-family:Arial,sans-serif;line-height:1.5;color:#2b1f16">
    <h1 style="font-size:22px;margin:0 0 16px">New Eagles Tacos inquiry</h1>
    <table style="border-collapse:collapse">${rows}</table>
    <h2 style="font-size:16px;margin:22px 0 8px">Notes</h2>
    <p style="white-space:pre-wrap;margin:0">${escapeHtml(inquiry.notes || "N/A")}</p>
  </body>
</html>`;
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}

function cleanUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";

  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "tel:"
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

function mapsUrlFor(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
