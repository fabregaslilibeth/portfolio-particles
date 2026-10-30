// Fills index.html with the site owner's details from VITE_* environment
// variables (.env locally, the host's env settings in production), and serves
// the configured country's outline as `virtual:country`.
import { loadEnv, type Plugin, type ResolvedConfig } from 'vite';
import { extractCountry, type CountryShape } from './country';

interface Project {
  title: string;
  meta: string;
  url?: string;
  /** Image in /public for the project's tile; a placeholder when missing. */
  image?: string;
}

interface SiteContent {
  name: string;
  role: string;
  description: string;
  intro: string;
  country: string;
  locationHeading: string;
  locationNote: string;
  email: string;
  links: { label: string; url: string }[];
  projects: Project[];
  skills: string[];
}

const DEFAULT_SKILLS = ['React', 'TypeScript', 'Three.js', 'WebGL', 'GSAP', 'Webflow', 'Figma', 'Node.js'];

const PLACEHOLDER_NAME = 'Your Name';
const PLACEHOLDER_EMAIL = 'hello@yourname.com';

const PLACEHOLDER_PROJECTS: Project[] = [
  { title: 'Northwind *Studio*', meta: 'Brand site · WebGL · 2026' },
  { title: 'Lumen *Records*', meta: 'E-commerce · Motion · 2025' },
  { title: 'Atlas *Outdoor*', meta: 'Campaign · Three.js · 2025' },
  { title: 'Kinfolk *Café*', meta: 'Webflow · Interaction · 2024' },
];

const SOCIALS = [
  ['VITE_LINKEDIN_URL', 'LinkedIn'],
  ['VITE_GITHUB_URL', 'GitHub'],
  ['VITE_INSTAGRAM_URL', 'Instagram'],
  ['VITE_DRIBBBLE_URL', 'Dribbble'],
] as const;

function readContent(env: Record<string, string>, warn: (msg: string) => void): SiteContent {
  const get = (key: string) => env[key]?.trim() ?? '';
  const name = get('VITE_NAME') || PLACEHOLDER_NAME;
  const role = get('VITE_ROLE') || 'Creative Developer';
  const country = get('VITE_COUNTRY') || 'Philippines';

  let email = get('VITE_EMAIL') || PLACEHOLDER_EMAIL;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    warn(`VITE_EMAIL "${email}" doesn't look like an email address; using the placeholder.`);
    email = PLACEHOLDER_EMAIL;
  }

  const links = SOCIALS.flatMap(([key, label]) => {
    const url = get(key);
    if (!url) return [];
    if (!isSafeUrl(url)) {
      warn(`${key} must start with https:// — ignoring it.`);
      return [];
    }
    return [{ label, url }];
  });

  return {
    name,
    role,
    description: get('VITE_DESCRIPTION') || `${name} — ${role}. Fast, interactive websites with motion and WebGL.`,
    intro:
      get('VITE_INTRO') ||
      'I turn bold designs into fast, tactile websites — motion, WebGL and front-end engineering for studios, agencies and brands that want the web to feel alive.',
    country,
    locationHeading: get('VITE_LOCATION_HEADING') || `Based in *${country}*`,
    locationNote: get('VITE_LOCATION_NOTE'),
    email,
    links,
    projects: readProjects(get('VITE_PROJECTS'), warn),
    skills: readSkills(get('VITE_SKILLS')),
  };
}

function readSkills(raw: string): string[] {
  const skills = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return skills.length ? skills : DEFAULT_SKILLS;
}

function readProjects(raw: string, warn: (msg: string) => void): Project[] {
  if (!raw) return PLACEHOLDER_PROJECTS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    warn(`VITE_PROJECTS isn't valid JSON (${(error as Error).message}); showing placeholder projects.`);
    return PLACEHOLDER_PROJECTS;
  }
  if (!Array.isArray(parsed)) {
    warn('VITE_PROJECTS must be a JSON array; showing placeholder projects.');
    return PLACEHOLDER_PROJECTS;
  }
  const projects = parsed.flatMap((item, i): Project[] => {
    const p = item as Partial<Record<keyof Project, unknown>>;
    if (typeof p?.title !== 'string' || !p.title.trim()) {
      warn(`VITE_PROJECTS[${i}] has no "title"; skipping it.`);
      return [];
    }
    const url = typeof p.url === 'string' && p.url.trim() ? p.url.trim() : undefined;
    if (url && !isSafeUrl(url)) warn(`VITE_PROJECTS[${i}].url must start with https:// — leaving the link off.`);
    const image = typeof p.image === 'string' && p.image.trim() ? p.image.trim() : undefined;
    // Same-site files only: the browser can't read pixels from other domains.
    const localImage = image && /^\/(?!\/)/.test(image) ? image : undefined;
    if (image && !localImage) warn(`VITE_PROJECTS[${i}].image must be a file in /public, like "/works/shot.jpg" — using a placeholder.`);
    return [
      {
        title: p.title.trim(),
        meta: typeof p.meta === 'string' ? p.meta.trim() : '',
        url: url && isSafeUrl(url) ? url : undefined,
        image: localImage,
      },
    ];
  });
  return projects.length ? projects : PLACEHOLDER_PROJECTS;
}

function isSafeUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Escaped text where `*word*` becomes the italic serif accent. */
function rich(text: string): string {
  return escapeHtml(text).replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

/** Bundled placeholder images, cycled for projects without an "image". */
const PLACEHOLDER_IMAGES = 4;

function renderProjects(projects: Project[]): string {
  return projects
    .map((p, i) => {
      const src = p.image ?? `/works/placeholder-${(i % PLACEHOLDER_IMAGES) + 1}.svg`;
      const alt = escapeHtml(p.title.replace(/\*([^*]+)\*/g, '$1'));
      const img = `<img src="${escapeHtml(src)}" alt="${alt}" width="1600" height="1000" loading="lazy" decoding="async" />`;
      const media = p.url
        ? `<a class="work__media" href="${escapeHtml(p.url)}" target="_blank" rel="noopener">${img}</a>`
        : `<div class="work__media">${img}</div>`;
      const link = p.url
        ? ` <a class="work__link" href="${escapeHtml(p.url)}" target="_blank" rel="noopener" data-dissolve>View project ↗</a>`
        : '';
      return `<li class="work">
              ${media}
              <h3 class="work__title">${rich(p.title)}</h3>
              <p class="work__meta">${escapeHtml(p.meta)}${link}</p>
            </li>`;
    })
    .join('\n            ');
}

function renderLinks(links: SiteContent['links']): string {
  if (!links.length) return '';
  const anchors = links.map(
    (l) => `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener" data-dissolve>${escapeHtml(l.label)}</a>`,
  );
  const sentence =
    anchors.length === 1 ? anchors[0] : `${anchors.slice(0, -1).join(', ')} and ${anchors[anchors.length - 1]}`;
  return `<p class="contact__alt">or find me on ${sentence}</p>`;
}

function render(html: string, c: SiteContent): string {
  const values: Record<string, string> = {
    name: escapeHtml(c.name),
    role: escapeHtml(c.role),
    description: escapeHtml(c.description),
    intro: rich(c.intro),
    locationHeading: rich(c.locationHeading),
    locationNote: c.locationNote ? `<p class="panel__sub">${escapeHtml(c.locationNote)}</p>` : '',
    email: escapeHtml(c.email),
    links: renderLinks(c.links),
    projects: renderProjects(c.projects),
    projectCount: String(c.projects.length).padStart(2, '0'),
    skills: c.skills.map((s) => `<li>${escapeHtml(s)}</li>`).join(''),
    year: String(new Date().getFullYear()),
  };
  return html.replace(/\{\{\s*(\w+)\s*\}\}/g, (token, key: string) => {
    if (key in values) return values[key];
    throw new Error(`index.html uses unknown placeholder ${token}`);
  });
}

export function siteContent(): Plugin {
  const virtualId = 'virtual:country';
  const resolvedId = '\0virtual:country';
  let content: SiteContent;
  let country: CountryShape;

  return {
    name: 'site-content',

    configResolved(config: ResolvedConfig) {
      const warn = (msg: string) => config.logger.warn(`[site] ${msg}`);
      content = readContent(loadEnv(config.mode, config.envDir || config.root, 'VITE_'), warn);
      country = extractCountry(content.country);

      if (config.command === 'build') {
        const missing = [
          content.name === PLACEHOLDER_NAME && 'VITE_NAME',
          content.email === PLACEHOLDER_EMAIL && 'VITE_EMAIL',
          content.projects === PLACEHOLDER_PROJECTS && 'VITE_PROJECTS',
        ].filter(Boolean);
        if (missing.length) warn(`Building with placeholder content — set ${missing.join(', ')} in .env.`);
      }
    },

    resolveId(id) {
      return id === virtualId ? resolvedId : undefined;
    },

    load(id) {
      return id === resolvedId ? `export default ${JSON.stringify(country)};` : undefined;
    },

    transformIndexHtml: {
      order: 'pre',
      handler: (html) => render(html, content),
    },
  };
}
