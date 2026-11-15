import { mkdir, writeFile } from "node:fs/promises";

const username = process.env.PROFILE_USERNAME || "twsf-strugg1es";
const token = process.env.GITHUB_TOKEN;
const apiBase = "https://api.github.com";
const apiHeaders = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": `${username}-profile-readme`,
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

async function getJson(url, options = {}) {
  const response = await fetch(url, { headers: apiHeaders, ...options });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  return { data: await response.json(), headers: response.headers };
}

async function getAll(path) {
  const results = [];
  let url = `${apiBase}${path}`;
  while (url) {
    const { data, headers } = await getJson(url);
    results.push(...data);
    const link = headers.get("link") || "";
    url = link.match(/<([^>]+)>; rel="next"/)?.[1] || "";
  }
  return results;
}

async function mapWithConcurrency(values, limit, callback) {
  const output = [];
  let index = 0;
  async function worker() {
    while (index < values.length) {
      const current = index++;
      output[current] = await callback(values[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return output;
}

async function contributionStats(from, to) {
  if (!token) return null;
  const query = `
    query ProfileStats($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          totalCommitContributions
          totalIssueContributions
          totalPullRequestContributions
          totalPullRequestReviewContributions
          totalRepositoriesWithContributedCommits
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays { date contributionCount }
            }
          }
        }
      }
    }`;
  const { data } = await getJson(`${apiBase}/graphql`, {
    method: "POST",
    headers: { ...apiHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { login: username, from, to } }),
  });
  if (data.errors?.length) throw new Error(data.errors.map((error) => error.message).join("; "));
  return data.data.user.contributionsCollection;
}

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, (character) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;",
  })[character]);
}

function plural(value, unit) {
  return `${value} ${unit}${value === 1 ? "" : "s"}`;
}

function uptime(createdAt) {
  const start = new Date(createdAt);
  const now = new Date();
  let years = now.getUTCFullYear() - start.getUTCFullYear();
  let anniversary = new Date(start);
  anniversary.setUTCFullYear(start.getUTCFullYear() + years);
  if (anniversary > now) {
    years--;
    anniversary = new Date(start);
    anniversary.setUTCFullYear(start.getUTCFullYear() + years);
  }
  let months = (now.getUTCFullYear() - anniversary.getUTCFullYear()) * 12 + now.getUTCMonth() - anniversary.getUTCMonth();
  let monthMark = new Date(anniversary);
  monthMark.setUTCMonth(monthMark.getUTCMonth() + months);
  if (monthMark > now) {
    months--;
    monthMark = new Date(anniversary);
    monthMark.setUTCMonth(monthMark.getUTCMonth() + months);
  }
  const days = Math.floor((now - monthMark) / 86_400_000);
  return `${plural(years, "year")}, ${plural(months, "month")}, ${plural(days, "day")}`;
}

function percentage(bytes, total) {
  if (!total) return "0%";
  return `${Math.round((bytes / total) * 100)}%`;
}

function cardSvg(stats, palette) {
  const width = 960;
  const height = 520;
  const graph = stats.weeks.slice(-52);
  const graphX = 35;
  const graphY = 434;
  const graphMarkup = graph.flatMap((week, weekIndex) =>
    week.contributionDays.map((day, dayIndex) => {
      const count = day.contributionCount;
      const color = count === 0 ? palette.graph0 : count < 2 ? palette.graph1 : count < 5 ? palette.graph2 : count < 10 ? palette.graph3 : palette.graph4;
      return `<rect x="${graphX + weekIndex * 16}" y="${graphY + dayIndex * 11}" width="10" height="7" rx="1" fill="${color}"/>`;
    }),
  ).join("");

  const rows = [
    ["Public repos", stats.repos, "Stars earned", stats.stars],
    ["Forks earned", stats.forks, "Followers", stats.followers],
    ["Commits", stats.commits, "Contributed to", stats.contributed],
    ["Pull requests", stats.prs, "Issues", stats.issues],
    ["Top repository", stats.topRepo, "Updated", stats.updated],
  ];
  const rowMarkup = rows.map((row, index) => {
    const y = 240 + index * 29;
    return `<text x="42" y="${y}" class="label">${escapeXml(row[0])}:</text>
      <text x="245" y="${y}" class="value">${escapeXml(row[1])}</text>
      <text x="440" y="${y}" class="label">${escapeXml(row[2])}:</text>
      <text x="665" y="${y}" class="value">${escapeXml(row[3])}</text>`;
  }).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Live GitHub profile statistics for ${escapeXml(username)}">
  <title>Live GitHub profile statistics for ${escapeXml(username)}</title>
  <style>
    .mono { font-family: Consolas, Menlo, Monaco, 'Courier New', monospace; }
    .heading { font: 700 18px Consolas, Menlo, Monaco, 'Courier New', monospace; fill: ${palette.heading}; }
    .dim { font: 14px Consolas, Menlo, Monaco, 'Courier New', monospace; fill: ${palette.dim}; }
    .label { font: 14px Consolas, Menlo, Monaco, 'Courier New', monospace; fill: ${palette.label}; }
    .value { font: 700 14px Consolas, Menlo, Monaco, 'Courier New', monospace; fill: ${palette.value}; }
  </style>
  <rect x="1" y="1" width="958" height="518" rx="12" fill="${palette.background}" stroke="${palette.border}" stroke-width="2"/>
  <text x="42" y="52" class="heading">$ ${escapeXml(username)}@github --profile</text>
  <line x1="42" y1="72" x2="918" y2="72" stroke="${palette.border}"/>
  <text x="42" y="105" class="label">Uptime:</text><text x="180" y="105" class="value">${escapeXml(stats.uptime)}</text>
  <text x="42" y="135" class="label">Location:</text><text x="180" y="135" class="value">${escapeXml(stats.location)}</text>
  <text x="42" y="165" class="label">Languages:</text><text x="180" y="165" class="value">${escapeXml(stats.languages)}</text>
  <line x1="42" y1="193" x2="918" y2="193" stroke="${palette.border}"/>
  <text x="42" y="222" class="heading">GitHub stats</text>
  ${rowMarkup}
  <line x1="42" y1="376" x2="918" y2="376" stroke="${palette.border}"/>
  <text x="42" y="405" class="heading">Last 12 months</text>
  <text x="275" y="405" class="label">Contributions:</text><text x="425" y="405" class="value">${escapeXml(stats.contributions)}</text>
  <text x="555" y="405" class="label">Reviews:</text><text x="660" y="405" class="value">${escapeXml(stats.reviews)}</text>
  ${graphMarkup}
</svg>\n`;
}

const user = (await getJson(`${apiBase}/users/${username}`)).data;
const allRepos = await getAll(`/users/${username}/repos?type=owner&sort=updated&per_page=100`);
const repos = allRepos.filter((repo) => !repo.fork);
const languageMaps = await mapWithConcurrency(repos, 5, async (repo) =>
  (await getJson(repo.languages_url)).data,
);
const languageBytes = {};
for (const languageMap of languageMaps) {
  for (const [language, bytes] of Object.entries(languageMap)) {
    languageBytes[language] = (languageBytes[language] || 0) + bytes;
  }
}
const totalLanguageBytes = Object.values(languageBytes).reduce((sum, bytes) => sum + bytes, 0);
const languages = Object.entries(languageBytes)
  .sort(([, first], [, second]) => second - first)
  .slice(0, 3)
  .map(([language, bytes]) => `${language} ${percentage(bytes, totalLanguageBytes)}`)
  .join(", ") || "No public code yet";
const topRepo = [...repos].sort((first, second) =>
  second.stargazers_count - first.stargazers_count || new Date(second.pushed_at || 0) - new Date(first.pushed_at || 0),
)[0];

const now = new Date();
const from = new Date(now);
from.setUTCFullYear(from.getUTCFullYear() - 1);
let contributions = null;
try {
  contributions = await contributionStats(from.toISOString(), now.toISOString());
} catch (error) {
  console.warn(`Could not load contribution data: ${error.message}`);
}

const emptyWeeks = Array.from({ length: 52 }, () => ({
  contributionDays: Array.from({ length: 7 }, () => ({ contributionCount: 0 })),
}));
const stats = {
  uptime: uptime(user.created_at),
  location: user.location || "Not set",
  languages,
  repos: repos.length,
  stars: repos.reduce((sum, repo) => sum + repo.stargazers_count, 0),
  forks: repos.reduce((sum, repo) => sum + repo.forks_count, 0),
  followers: user.followers,
  commits: contributions?.totalCommitContributions ?? "—",
  contributed: contributions?.totalRepositoriesWithContributedCommits ?? "—",
  prs: contributions?.totalPullRequestContributions ?? "—",
  issues: contributions?.totalIssueContributions ?? "—",
  topRepo: topRepo ? `${topRepo.name} (${topRepo.stargazers_count} ★)` : "—",
  updated: now.toISOString().slice(0, 10),
  contributions: contributions?.contributionCalendar.totalContributions ?? "—",
  reviews: contributions?.totalPullRequestReviewContributions ?? "—",
  weeks: contributions?.contributionCalendar.weeks ?? emptyWeeks,
};

const dark = {
  background: "#0d1117", border: "#30363d", heading: "#58a6ff", dim: "#8b949e", label: "#ffa657", value: "#c9d1d9",
  graph0: "#161b22", graph1: "#0e4429", graph2: "#006d32", graph3: "#26a641", graph4: "#39d353",
};
const light = {
  background: "#ffffff", border: "#d0d7de", heading: "#0969da", dim: "#57606a", label: "#bc4c00", value: "#24292f",
  graph0: "#ebedf0", graph1: "#9be9a8", graph2: "#40c463", graph3: "#30a14e", graph4: "#216e39",
};

await mkdir(".", { recursive: true });
await Promise.all([
  writeFile("dark_mode.svg", cardSvg(stats, dark)),
  writeFile("light_mode.svg", cardSvg(stats, light)),
]);
console.log(`Generated profile cards for ${username}.`);
