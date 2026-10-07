// Like counter for the GPX courses on the Cycling page.
//
//   GET  /likes                         -> { "<courseId>": count, ... }
//   POST /likes  {"course": "<courseId>"} -> { "course": "<courseId>", "count": n }
//
// Only the total per course is stored. Nothing about the visitor (no IP, no
// hash, no timestamp) is written anywhere; "vote once" is enforced in the
// visitor's browser.

// same derivation as in gpx.html: file name without folder and extension
function courseId(file) {
  return file.split(/[\\/]/).pop().replace(/\.gpx$/i, "");
}

// course IDs that may be liked, taken from the site's own course list
async function knownCourses(env) {
  const res = await fetch(env.COURSES_URL, { cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) throw new Error(`Could not load course list (${res.status})`);
  const courses = await res.json();
  return new Set(courses.map(c => courseId(c.file)));
}

function corsHeaders(origin, env) {
  const allowed = env.ALLOWED_ORIGINS.split(",").map(o => o.trim());
  if (!origin || !allowed.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin, env);
    const { pathname } = new URL(request.url);

    if (pathname !== "/likes") return json({ error: "Not found" }, 404, cors);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method === "GET") {
      const { results } = await env.DB.prepare("SELECT course, count FROM likes").all();
      return json(Object.fromEntries(results.map(r => [r.course, r.count])), 200, cors);
    }

    if (request.method === "POST") {
      // votes only come from this website's own pages
      if (!cors["Access-Control-Allow-Origin"]) return json({ error: "Forbidden" }, 403, cors);

      let course;
      try {
        ({ course } = await request.json());
      } catch {
        return json({ error: "Invalid JSON" }, 400, cors);
      }
      if (typeof course !== "string" || !(await knownCourses(env)).has(course)) {
        return json({ error: "Unknown course" }, 400, cors);
      }

      const row = await env.DB.prepare(
        `INSERT INTO likes (course, count) VALUES (?, 1)
         ON CONFLICT(course) DO UPDATE SET count = count + 1
         RETURNING count`
      ).bind(course).first();
      return json({ course, count: row.count }, 200, cors);
    }

    return json({ error: "Method not allowed" }, 405, cors);
  },
};
