// Basic local latency measurements for the Cloudflare architecture (docs/local-cloudflare.md,
// "Performance sanity"). Not a load test: sequential requests against the local stack started by
// scripts/e2e-cloudflare-local.mjs --perf. Local numbers only indicate relative costs; production
// latency also includes Vercel ↔ Cloudflare network time.
const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100"
const WORKER = process.env.WORKER_URL ?? "http://127.0.0.1:8787"

async function login(email) {
  const jar = new Map()
  const keep = (res) =>
    res.headers.getSetCookie().forEach((c) => {
      const [pair] = c.split(";")
      const i = pair.indexOf("=")
      jar.set(pair.slice(0, i), pair.slice(i + 1))
    })
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ")
  const csrf = await fetch(`${BASE}/api/auth/csrf`)
  keep(csrf)
  const { csrfToken } = await csrf.json()
  const started = performance.now()
  keep(
    await fetch(`${BASE}/api/auth/callback/credentials`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie() },
      body: new URLSearchParams({ csrfToken, email, password: "Password123!" }),
    })
  )
  return { cookie: cookie(), ms: performance.now() - started }
}

async function measure(label, times, fn) {
  const samples = []
  for (let i = 0; i < times; i++) {
    const started = performance.now()
    await fn(i)
    samples.push(performance.now() - started)
  }
  samples.sort((a, b) => a - b)
  const pick = (q) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))]
  return { label, n: times, median: pick(0.5), p95: pick(0.95) }
}

const ok = async (res, expected = 200) => {
  if (res.status !== expected) throw new Error(`${res.url} → ${res.status}`)
  await res.arrayBuffer()
}

const logins = []
for (let i = 0; i < 5; i++) logins.push((await login("registry@sms.inxapp.net")).ms)
const staff = (await login("registry@sms.inxapp.net")).cookie
const student = (await login("farhana.akter@sms.inxapp.net")).cookie
const students = await (await fetch(`${BASE}/api/students`, { headers: { cookie: staff } })).json()
const farhana = students.students.find((s) => s.fullName === "Farhana Akter").id
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date())
const STRAT = "5e3d0a1c-0000-4000-8000-000000000103"
const MB = 1024 * 1024
const onePdf = new Uint8Array(MB)
onePdf.set(new TextEncoder().encode("%PDF-1.4 perf"))

const results = [
  { label: "sign-in (bcrypt in Next.js + Worker lookup)", n: logins.length, median: [...logins].sort((a, b) => a - b)[2], p95: Math.max(...logins) },
  await measure("Worker GET /health (direct)", 20, async () => ok(await fetch(`${WORKER}/health`))),
  await measure("API GET /api/students (session + list: 2 Worker calls)", 20, async () => ok(await fetch(`${BASE}/api/students`, { headers: { cookie: staff } }))),
  await measure("API GET /api/students/:id/fees", 20, async () => ok(await fetch(`${BASE}/api/students/${farhana}/fees`, { headers: { cookie: staff } }))),
  await measure("page GET /staff/dashboard (server render)", 10, async () => ok(await fetch(`${BASE}/staff/dashboard`, { headers: { cookie: staff } }))),
  await measure("page GET /staff/students/:id (server render)", 10, async () => ok(await fetch(`${BASE}/staff/students/${farhana}`, { headers: { cookie: staff } }))),
  await measure("API POST payment (single conditional INSERT)", 10, async (i) =>
    ok(
      await fetch(`${BASE}/api/students/${farhana}/payments`, {
        method: "POST",
        headers: { cookie: staff, "content-type": "application/json" },
        body: JSON.stringify({ amount: "1.00", paymentDate: today, referenceNumber: `PERF-${Date.now()}-${i}` }),
      }),
      201
    )
  ),
  await measure("upload 1 MB: upload URL + direct PUT to the Worker", 5, async () => {
    const grant = await fetch(`${BASE}/api/assessments/${STRAT}/submissions/upload-url`, {
      method: "POST",
      headers: { cookie: student, "content-type": "application/json" },
      body: JSON.stringify({ fileName: "perf.pdf", fileType: "application/pdf", fileSize: MB }),
    })
    const { upload } = await grant.json()
    await ok(await fetch(upload.url, { method: "PUT", headers: upload.headers, body: onePdf }))
  }),
]
const submission = (await (await fetch(`${BASE}/api/assessments`, { headers: { cookie: student } })).json()).assessments.find((a) => a.id === STRAT).submission.id
results.push(
  await measure("download signing: /api/files/:id → 302", 10, async () => ok(await fetch(`${BASE}/api/files/${submission}`, { headers: { cookie: student }, redirect: "manual" }), 302)),
  await measure("download 1 MB end to end (redirect + R2 stream)", 5, async () => ok(await fetch(`${BASE}/api/files/${submission}`, { headers: { cookie: student } })))
)

console.log("\nLocal latency (ms)            median     p95")
for (const r of results) console.log(`${r.label.padEnd(62)} ${r.median.toFixed(0).padStart(6)} ${r.p95.toFixed(0).padStart(7)}   (n=${r.n})`)
