// Genera las imágenes de estadísticas del README a partir de la API GraphQL de GitHub,
// sin depender de servicios externos (github-readme-stats, streak-stats, activity-graph).
// Uso: GITHUB_TOKEN=xxx [GITHUB_USER=Aragorn7372] node scripts/generate-stats.mjs

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TOKEN = process.env.GITHUB_TOKEN;
const USER = process.env.GITHUB_USER || "Aragorn7372";
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "stats-images");

// Variables de diseño: cada tema genera su juego de imágenes (sufijo "" o "-light")
const THEMES = {
  "": { bg: "#0D1117", title: "#58A6FF", text: "#C9D1D9", icon: "#58A6FF", fire: "#FF6B6B", currStreak: "#BF91F3", point: "#FFFFFF" },
  "-light": { bg: "#FFFFFF", title: "#0969DA", text: "#1F2328", icon: "#0969DA", fire: "#FF6B6B", currStreak: "#8250DF", point: "#1F2328" },
};
const FONT = "'Segoe UI', Ubuntu, Sans-Serif";

if (!TOKEN) {
  console.error("Falta la variable de entorno GITHUB_TOKEN.");
  process.exit(1);
}

// ---------------------------------------------------------------- API

async function gql(query, variables = {}) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "generate-stats",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function fetchUser() {
  const { user } = await gql(
    `query($login: String!) {
      user(login: $login) {
        name
        login
        createdAt
        followers { totalCount }
        pullRequests { totalCount }
        openIssues: issues(states: OPEN) { totalCount }
        closedIssues: issues(states: CLOSED) { totalCount }
        repositoriesContributedTo(first: 1, contributionTypes: [COMMIT, ISSUE, PULL_REQUEST, REPOSITORY]) { totalCount }
        contributionsCollection {
          totalCommitContributions
          totalPullRequestReviewContributions
        }
      }
    }`,
    { login: USER },
  );
  if (!user) throw new Error(`Usuario ${USER} no encontrado`);
  return user;
}

async function fetchRepos() {
  const repos = [];
  let after = null;
  do {
    const { user } = await gql(
      `query($login: String!, $after: String) {
        user(login: $login) {
          repositories(ownerAffiliations: OWNER, isFork: false, first: 100, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes {
              stargazerCount
              languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
                edges { size node { name color } }
              }
            }
          }
        }
      }`,
      { login: USER, after },
    );
    const page = user.repositories;
    repos.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return repos;
}

// Calendario completo, año a año desde la creación de la cuenta (la API limita a 1 año por consulta)
async function fetchCalendar(createdAt) {
  const days = new Map();
  const now = new Date();
  let from = new Date(createdAt);
  while (from < now) {
    const to = new Date(Math.min(from.getTime() + 365 * 864e5, now.getTime()));
    const { user } = await gql(
      `query($login: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $login) {
          contributionsCollection(from: $from, to: $to) {
            contributionCalendar { weeks { contributionDays { date contributionCount } } }
          }
        }
      }`,
      { login: USER, from: from.toISOString(), to: to.toISOString() },
    );
    for (const week of user.contributionsCollection.contributionCalendar.weeks) {
      for (const d of week.contributionDays) days.set(d.date, d.contributionCount);
    }
    from = to;
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
}

// ---------------------------------------------------------------- Cálculos

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n) => n.toLocaleString("en-US");

// Misma fórmula de rango que github-readme-stats
function calculateRank({ commits, prs, issues, reviews, stars, followers }) {
  const expCdf = (x) => 1 - 2 ** -x;
  const logNormCdf = (x) => x / (1 + x);
  const W = { commits: 2, prs: 3, issues: 1, reviews: 1, stars: 4, followers: 1 };
  const total = Object.values(W).reduce((a, b) => a + b, 0);
  const rank =
    1 -
    (W.commits * expCdf(commits / 250) +
      W.prs * expCdf(prs / 50) +
      W.issues * expCdf(issues / 25) +
      W.reviews * expCdf(reviews / 2) +
      W.stars * logNormCdf(stars / 50) +
      W.followers * logNormCdf(followers / 10)) /
      total;
  const thresholds = [1, 12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100];
  const levels = ["S", "A+", "A", "A-", "B+", "B", "B-", "C+", "C"];
  const percentile = rank * 100;
  return { level: levels[thresholds.findIndex((t) => percentile <= t)], percentile };
}

function topLanguages(repos, count = 6) {
  const langs = new Map();
  for (const repo of repos) {
    for (const { size, node } of repo.languages.edges) {
      const prev = langs.get(node.name) || { name: node.name, color: node.color || "#858585", size: 0 };
      prev.size += size;
      langs.set(node.name, prev);
    }
  }
  const top = [...langs.values()].sort((a, b) => b.size - a.size).slice(0, count);
  const total = top.reduce((a, l) => a + l.size, 0);
  return top.map((l) => ({ ...l, percent: (l.size / total) * 100 }));
}

function calculateStreaks(days) {
  // Si hoy aún no hay contribuciones, la racha actual se cuenta hasta ayer
  const list = days.at(-1)?.count === 0 ? days.slice(0, -1) : days;
  const firstIdx = days.findIndex((d) => d.count > 0);
  const total = days.reduce((a, d) => a + d.count, 0);

  let longest = { length: 0, start: null, end: null };
  let run = { length: 0, start: null, end: null };
  for (const d of days) {
    if (d.count > 0) {
      run = run.length ? { ...run, length: run.length + 1, end: d.date } : { length: 1, start: d.date, end: d.date };
      if (run.length > longest.length) longest = run;
    } else {
      run = { length: 0, start: null, end: null };
    }
  }

  let current = { length: 0, start: null, end: null };
  for (let i = list.length - 1; i >= 0 && list[i].count > 0; i--) {
    current = { length: current.length + 1, start: list[i].date, end: current.end ?? list[i].date };
  }

  return {
    total,
    firstDate: firstIdx >= 0 ? days[firstIdx].date : days.at(-1).date,
    today: days.at(-1).date,
    current,
    longest,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(iso, withYear) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}${withYear ? `, ${y}` : ""}`;
}
function fmtRange(start, end, today) {
  if (!start) return fmtDate(today, false);
  const year = today.slice(0, 4);
  const withYear = start.slice(0, 4) !== year || end.slice(0, 4) !== year;
  if (start === end) return fmtDate(start, withYear);
  return `${fmtDate(start, withYear)} - ${fmtDate(end, withYear)}`;
}

// ---------------------------------------------------------------- Renderers

const ICONS = {
  star: "M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25zm0 2.445L6.615 5.5a.75.75 0 01-.564.41l-3.097.45 2.24 2.184a.75.75 0 01.216.664l-.528 3.084 2.769-1.456a.75.75 0 01.698 0l2.77 1.456-.53-3.084a.75.75 0 01.216-.664l2.24-2.183-3.096-.45a.75.75 0 01-.564-.41L8 2.694v.001z",
  commits: "M1.643 3.143L.427 1.927A.25.25 0 000 2.104V5.75c0 .138.112.25.25.25h3.646a.25.25 0 00.177-.427L2.715 4.215a6.5 6.5 0 11-1.18 4.458.75.75 0 10-1.493.154 8.001 8.001 0 101.6-5.684zM7.75 4a.75.75 0 01.75.75v2.992l2.028.812a.75.75 0 01-.557 1.392l-2.5-1A.75.75 0 017 8.25v-3.5A.75.75 0 017.75 4z",
  prs: "M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z",
  issues: "M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8zm9 3a1 1 0 11-2 0 1 1 0 012 0zm-.25-6.25a.75.75 0 00-1.5 0v3.5a.75.75 0 001.5 0v-3.5z",
  contribs: "M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1V9h-8c-.356 0-.694.074-1 .208V2.5a1 1 0 011-1h8zM5 12.25v3.25a.25.25 0 00.4.2l1.45-1.087a.25.25 0 01.3 0L8.6 15.7a.25.25 0 00.4-.2v-3.25a.25.25 0 00-.25-.25h-3.5a.25.25 0 00-.25.25z",
};

const CARD_ANIMATIONS = `
    @keyframes scaleInAnimation {
      from { transform: translate(-5px, 5px) scale(0); }
      to { transform: translate(-5px, 5px) scale(1); }
    }
    @keyframes fadeInAnimation {
      from { opacity: 0; }
      to { opacity: 1; }
    }`;

function renderGeneralStats(t, { name, stats, rank }) {
  const circumference = 2 * Math.PI * 40;
  const offset = (rank.percentile / 100) * circumference;
  const rows = [
    ["star", "Total Stars Earned:", stats.stars],
    ["commits", "Total Commits (last year):", stats.commits],
    ["prs", "Total PRs:", stats.prs],
    ["issues", "Total Issues:", stats.issues],
    ["contribs", "Contributed to (last year):", stats.contributedTo],
  ]
    .map(
      ([icon, label, value], i) => `
    <g transform="translate(0, ${i * 25})">
      <g class="stagger" style="animation-delay: ${450 + i * 150}ms" transform="translate(25, 0)">
        <svg class="icon" viewBox="0 0 16 16" width="16" height="16"><path fill-rule="evenodd" d="${ICONS[icon]}"/></svg>
        <text class="stat bold" x="25" y="12.5">${label}</text>
        <text class="stat bold" x="219.01" y="12.5">${fmt(value)}</text>
      </g>
    </g>`,
    )
    .join("");

  return `<svg width="467" height="195" viewBox="0 0 467 195" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="descId">
  <title id="titleId">${esc(name)}'s GitHub Stats, Rank: ${rank.level}</title>
  <desc id="descId">Total Stars Earned: ${stats.stars}, Total Commits (last year): ${stats.commits}, Total PRs: ${stats.prs}, Total Issues: ${stats.issues}, Contributed to (last year): ${stats.contributedTo}</desc>
  <style>
    .header { font: 600 18px ${FONT}; fill: ${t.title}; animation: fadeInAnimation 0.8s ease-in-out forwards; }
    @supports(-moz-appearance: auto) { .header { font-size: 15.5px; } }
    .stat { font: 600 14px 'Segoe UI', Ubuntu, "Helvetica Neue", Sans-Serif; fill: ${t.text}; }
    @supports(-moz-appearance: auto) { .stat { font-size: 12px; } }
    .stagger { opacity: 0; animation: fadeInAnimation 0.3s ease-in-out forwards; }
    .rank-text { font: 800 24px ${FONT}; fill: ${t.text}; animation: scaleInAnimation 0.3s ease-in-out forwards; }
    .bold { font-weight: 700 }
    .icon { fill: ${t.icon}; display: block; }
    .rank-circle-rim { stroke: ${t.title}; fill: none; stroke-width: 6; opacity: 0.2; }
    .rank-circle {
      stroke: ${t.title}; stroke-dasharray: 250; fill: none; stroke-width: 6; stroke-linecap: round; opacity: 0.8;
      transform-origin: -10px 8px; transform: rotate(-90deg); animation: rankAnimation 1s forwards ease-in-out;
    }
    @keyframes rankAnimation {
      from { stroke-dashoffset: ${circumference}; }
      to { stroke-dashoffset: ${offset}; }
    }
    ${CARD_ANIMATIONS}
  </style>
  <rect x="0.5" y="0.5" rx="4.5" height="99%" width="466" fill="${t.bg}" stroke-opacity="0"/>
  <g transform="translate(25, 35)"><text x="0" y="0" class="header">${esc(name)}'s GitHub Stats</text></g>
  <g transform="translate(0, 55)">
    <g transform="translate(390.5, 47.5)">
      <circle class="rank-circle-rim" cx="-10" cy="8" r="40"/>
      <circle class="rank-circle" cx="-10" cy="8" r="40"/>
      <g class="rank-text">
        <text x="-5" y="3" alignment-baseline="central" dominant-baseline="central" text-anchor="middle">${rank.level}</text>
      </g>
    </g>
    <svg x="0" y="0">${rows}
    </svg>
  </g>
</svg>
`;
}

function renderTopLangs(t, langs) {
  const barWidth = 250;
  const perColumn = Math.ceil(langs.length / 2);
  let x = 0;
  const bars = langs
    .map((l) => {
      const w = (l.percent / 100) * barWidth;
      const rect = `<rect mask="url(#rect-mask)" x="${x.toFixed(2)}" y="0" width="${w.toFixed(2)}" height="8" fill="${l.color}"/>`;
      x += w;
      return rect;
    })
    .join("\n      ");
  const legend = langs
    .map((l, i) => {
      const col = Math.floor(i / perColumn);
      const row = i % perColumn;
      return `
      <g transform="translate(${col * 150}, ${row * 25})">
        <g class="stagger" style="animation-delay: ${450 + row * 150}ms">
          <circle cx="5" cy="6" r="5" fill="${l.color}"/>
          <text x="15" y="10" class="lang-name">${esc(l.name)} ${l.percent.toFixed(2)}%</text>
        </g>
      </g>`;
    })
    .join("");
  const height = 90 + perColumn * 25;

  return `<svg width="300" height="${height}" viewBox="0 0 300 ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="titleId">
  <title id="titleId">Most Used Languages</title>
  <style>
    .header { font: 600 18px ${FONT}; fill: ${t.title}; animation: fadeInAnimation 0.8s ease-in-out forwards; }
    @supports(-moz-appearance: auto) { .header { font-size: 15.5px; } }
    .lang-name { font: 400 11px ${FONT}; fill: ${t.text}; }
    .stagger { opacity: 0; animation: fadeInAnimation 0.3s ease-in-out forwards; }
    #rect-mask rect { animation: slideInAnimation 1s ease-in-out forwards; }
    @keyframes slideInAnimation { from { width: 0; } to { width: ${barWidth}px; } }
    ${CARD_ANIMATIONS}
  </style>
  <rect x="0.5" y="0.5" rx="4.5" height="99%" width="299" fill="${t.bg}" stroke-opacity="0"/>
  <g transform="translate(25, 35)"><text x="0" y="0" class="header">Most Used Languages</text></g>
  <g transform="translate(0, 55)">
    <svg x="25">
      <mask id="rect-mask"><rect x="0" y="0" width="${barWidth}" height="8" fill="white" rx="5"/></mask>
      ${bars}
      <g transform="translate(0, 25)">${legend}
      </g>
    </svg>
  </g>
</svg>
`;
}

function renderStreak(t, s) {
  const text = (x, y, content, { color = t.text, weight = 400, size = 14, delay, anim } = {}) => `
      <g transform="translate(${x}, ${y})">
        <text x="0" y="32" text-anchor="middle" fill="${color}" font-family='"Segoe UI", Ubuntu, sans-serif' font-weight="${weight}" font-size="${size}px" style="${anim ?? `opacity: 0; animation: fadein 0.5s linear forwards ${delay}s`}">${content}</text>
      </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" style="isolation: isolate" viewBox="0 0 495 195" width="495px" height="195px" direction="ltr">
  <style>
    @keyframes currstreak {
      0% { font-size: 3px; opacity: 0.2; }
      80% { font-size: 34px; opacity: 1; }
      100% { font-size: 28px; opacity: 1; }
    }
    @keyframes fadein {
      0% { opacity: 0; }
      100% { opacity: 1; }
    }
  </style>
  <defs>
    <clipPath id="outer_rectangle"><rect width="495" height="195" rx="4.5"/></clipPath>
    <mask id="mask_out_ring_behind_fire">
      <rect width="495" height="195" fill="white"/>
      <ellipse cx="247.5" cy="32" rx="13" ry="18" fill="black"/>
    </mask>
  </defs>
  <g clip-path="url(#outer_rectangle)">
    <rect stroke-opacity="0" fill="${t.bg}" rx="4.5" x="0.5" y="0.5" width="494" height="194"/>
    <line x1="165" y1="28" x2="165" y2="170" stroke-width="1" stroke="${t.title}"/>
    <line x1="330" y1="28" x2="330" y2="170" stroke-width="1" stroke="${t.title}"/>
    <g>${text(82.5, 48, fmt(s.total), { weight: 700, size: 28, delay: 0.6 })}${text(82.5, 84, "Total Contributions", { delay: 0.7 })}${text(82.5, 114, `${fmtDate(s.firstDate, true)} - Present`,{ size: 12, delay: 0.8 })}
    </g>
    <g>${text(247.5, 108, "Current Streak", { color: t.title, weight: 700, delay: 0.9 })}
      <g transform="translate(247.5, 145)">
        <text x="0" y="21" text-anchor="middle" fill="${t.text}" font-family='"Segoe UI", Ubuntu, sans-serif' font-weight="400" font-size="12px" style="opacity: 0; animation: fadein 0.5s linear forwards 0.9s">${fmtRange(s.current.start, s.current.end, s.today)}</text>
      </g>
      <g mask="url(#mask_out_ring_behind_fire)">
        <circle cx="247.5" cy="71" r="40" fill="none" stroke="${t.title}" stroke-width="5" style="opacity: 0; animation: fadein 0.5s linear forwards 0.4s"/>
      </g>
      <g transform="translate(247.5, 19.5)" style="opacity: 0; animation: fadein 0.5s linear forwards 0.6s">
        <path d="M 1.5 0.67 C 1.5 0.67 2.24 3.32 2.24 5.47 C 2.24 7.53 0.89 9.2 -1.17 9.2 C -3.23 9.2 -4.79 7.53 -4.79 5.47 L -4.76 5.11 C -6.78 7.51 -8 10.62 -8 13.99 C -8 18.41 -4.42 22 0 22 C 4.42 22 8 18.41 8 13.99 C 8 8.6 5.41 3.79 1.5 0.67 Z M -0.29 19 C -2.07 19 -3.51 17.6 -3.51 15.86 C -3.51 14.24 -2.46 13.1 -0.7 12.74 C 1.07 12.38 2.9 11.53 3.92 10.16 C 4.31 11.45 4.51 12.81 4.51 14.2 C 4.51 16.85 2.36 19 -0.29 19 Z" fill="${t.fire}"/>
      </g>${text(247.5, 48, fmt(s.current.length), { color: t.currStreak, weight: 700, size: 28, anim: "animation: currstreak 0.6s linear forwards" })}
    </g>
    <g>${text(412.5, 48, fmt(s.longest.length), { weight: 700, size: 28, delay: 1.2 })}${text(412.5, 84, "Longest Streak", { delay: 1.3 })}${text(412.5, 114, fmtRange(s.longest.start, s.longest.end, s.today), { size: 12, delay: 1.4 })}
    </g>
  </g>
</svg>
`;
}

function renderActivityGraph(t, name, days) {
  const last = days.slice(-31);
  const [left, right, top, bottom] = [90, 1150, 80, 350];
  const maxCount = Math.max(...last.map((d) => d.count), 1);
  // Escala del eje Y con un paso "redondo" (1, 2, 5, 10...) y unas 8 divisiones
  const rawStep = maxCount / 8;
  const mag = 10 ** Math.floor(Math.log10(rawStep || 1));
  const step = Math.max(1, [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= rawStep));
  const yMax = Math.ceil((maxCount + 1) / step) * step;

  const px = (i) => left + (i * (right - left)) / (last.length - 1);
  const py = (v) => bottom - (v / yMax) * (bottom - top);
  const pts = last.map((d, i) => [px(i), py(d.count)]);

  let path = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const dx = (x1 - x0) / 3;
    path += `C${(x0 + dx).toFixed(3)},${y0.toFixed(3)},${(x1 - dx).toFixed(3)},${y1.toFixed(3)},${x1.toFixed(3)},${y1.toFixed(3)}`;
  }

  const vGrid = pts.map(([x]) => `<line x1="${x}" x2="${x}" y1="${top}" y2="${bottom}" class="ct-grid"/>`).join("");
  const yTicks = [];
  for (let v = 0; v <= yMax; v += step) yTicks.push(v);
  const hGrid = yTicks.map((v) => `<line y1="${py(v)}" y2="${py(v)}" x1="${left}" x2="${right}" class="ct-grid"/>`).join("");
  const xLabels = last
    .map((d, i) => `<text x="${px(i)}" y="370" text-anchor="middle" class="ct-label">${Number(d.date.slice(8))}</text>`)
    .join("");
  const yLabels = yTicks.map((v) => `<text x="80" y="${py(v) + 4}" text-anchor="end" class="ct-label">${v}</text>`).join("");
  const points = pts
    .map(([x, y], i) => `<line x1="${x}" y1="${y}" x2="${x + 0.01}" y2="${y}" class="ct-point"><title>${last[i].date}: ${last[i].count}</title></line>`)
    .join("");

  return `<svg width="1200" height="420" viewBox="0 0 1200 420" fill="none" xmlns="http://www.w3.org/2000/svg">
  <style>
    .header { font: 600 20px ${FONT}; fill: ${t.title}; }
    .ct-label { fill: ${t.title}; font: 600 12px ${FONT}; }
    .ct-axis-title { font-size: 12px; }
    .ct-grid { stroke: ${t.title}; stroke-width: 1px; stroke-opacity: 0.3; stroke-dasharray: 2px; }
    .ct-point { stroke-width: 10px; stroke-linecap: round; stroke: ${t.point}; animation: blink 1s ease-in-out forwards; }
    .ct-line { fill: none; stroke-width: 4px; stroke-dasharray: 5000; stroke-dashoffset: 5000; stroke: ${t.title}; animation: dash 5s ease-in-out forwards; }
    @keyframes blink {
      from { opacity: 0; transform: translateX(-20px); }
      to { opacity: 1; transform: translateX(0); }
    }
    @keyframes dash { to { stroke-dashoffset: 0; } }
  </style>
  <rect x="0" y="0" width="100%" height="100%" fill="${t.bg}"/>
  <text x="600" y="38" text-anchor="middle" class="header">${esc(name)}'s Contribution Graph</text>
  <g>${vGrid}${hGrid}</g>
  <path d="${path}" class="ct-line"/>
  <g>${points}</g>
  <g>${xLabels}${yLabels}</g>
  <text class="ct-axis-title ct-label" x="620" y="400" dominant-baseline="text-after-edge" text-anchor="middle">Days</text>
  <text class="ct-axis-title ct-label" x="20" y="215" transform="rotate(-90, 20, 215)" dominant-baseline="hanging" text-anchor="middle">Contributions</text>
</svg>
`;
}

// ---------------------------------------------------------------- Main

async function main() {
  const user = await fetchUser();
  const [repos, days] = await Promise.all([fetchRepos(), fetchCalendar(user.createdAt)]);
  const name = user.name || user.login;

  const stats = {
    stars: repos.reduce((a, r) => a + r.stargazerCount, 0),
    commits: user.contributionsCollection.totalCommitContributions,
    prs: user.pullRequests.totalCount,
    issues: user.openIssues.totalCount + user.closedIssues.totalCount,
    contributedTo: user.repositoriesContributedTo.totalCount,
  };
  const rank = calculateRank({
    ...stats,
    reviews: user.contributionsCollection.totalPullRequestReviewContributions,
    followers: user.followers.totalCount,
  });

  // Se generan todas en memoria antes de escribir: si algo falla, se conservan las anteriores
  const langs = topLanguages(repos);
  const streaks = calculateStreaks(days);
  const files = {};
  for (const [suffix, t] of Object.entries(THEMES)) {
    files[`general-stats${suffix}.svg`] = renderGeneralStats(t, { name, stats, rank });
    files[`top-langs${suffix}.svg`] = renderTopLangs(t, langs);
    files[`streak-stats${suffix}.svg`] = renderStreak(t, streaks);
    files[`activity-graph${suffix}.svg`] = renderActivityGraph(t, name, days);
  }

  await mkdir(OUT_DIR, { recursive: true });
  for (const [file, svg] of Object.entries(files)) {
    await writeFile(join(OUT_DIR, file), svg);
    console.log(`✔ ${file}`);
  }
}

main().catch((err) => {
  console.error("Error generando las estadísticas:", err.message);
  process.exit(1);
});
