const MarkdownIt = require("markdown-it");
const markdownItAnchor = require("markdown-it-anchor");
const sanitizeHtml = require("sanitize-html");
const slugify = require("slugify");
const katex = require("katex");

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
}).use(markdownItAnchor, { slugify: (s) => slugify(s, { lower: true, strict: true }) });

function makeSlug(value) {
  return slugify(String(value || ""), { lower: true, strict: true });
}

function parseRedirect(content) {
  const match = content.match(/^#REDIRECT\s+\[\[([^\]]+)\]\]/i);
  if (!match) return null;
  return makeSlug(match[1].trim());
}

function extractCategories(content) {
  const found = [];
  const regex = /\[\[Category:([^\]]+)\]\]/gi;
  let match = regex.exec(content);
  while (match) {
    found.push(match[1].trim());
    match = regex.exec(content);
  }
  return Array.from(new Set(found));
}

function extractInfobox(content) {
  const infoboxRegex = /\{\{Infobox\s+([^\|\}]+)([\s\S]*?)\}\}/i;
  const match = content.match(infoboxRegex);
  if (!match) return { infobox: null, withoutInfobox: content };
  const kind = match[1].trim();
  const fieldsRaw = match[2]
    .split("|")
    .map((line) => line.trim())
    .filter(Boolean);
  const fields = fieldsRaw
    .map((line) => {
      const [key, ...rest] = line.split("=");
      if (!rest.length) return null;
      return { key: key.trim(), value: rest.join("=").trim() };
    })
    .filter(Boolean);
  return {
    infobox: { kind, fields },
    withoutInfobox: content.replace(infoboxRegex, "").trim(),
  };
}

function buildToc(renderedHtml) {
  const toc = [];
  const headingRegex = /<(h[1-6]) id="([^"]+)">([^<]+)<\/h[1-6]>/g;
  let match = headingRegex.exec(renderedHtml);
  while (match) {
    toc.push({
      level: Number(match[1].slice(1)),
      id: match[2],
      text: match[3],
    });
    match = headingRegex.exec(renderedHtml);
  }
  return toc;
}

function withInternalLinks(raw) {
  return raw.replace(/\[\[([^\]]+)\]\]/g, (_, target) => {
    const clean = target.trim();
    if (/^Category:/i.test(clean)) return "";
    const slug = makeSlug(clean);
    return `[${clean}](/wiki/${slug})`;
  });
}

function withTemplates(raw, templateMap = {}) {
  return raw.replace(/\{\{([^}]+)\}\}/g, (full, inner) => {
    if (/^Infobox\s+/i.test(inner.trim())) return full;
    const key = inner.trim();
    const normalized = key.replace(/^Template:/i, "").trim();
    if (templateMap[normalized]) {
      return templateMap[normalized];
    }
    return "";
  });
}

function withReferences(raw) {
  let index = 0;
  const refs = [];
  const replaced = raw.replace(/<ref>([\s\S]*?)<\/ref>/gi, (_, refBody) => {
    index += 1;
    refs.push({ n: index, body: refBody.trim() });
    return `<sup id="ref-${index}"><a href="#note-${index}">[${index}]</a></sup>`;
  });
  return { replaced, refs };
}

// Render $$ ... $$ and $ ... $ with KaTeX server-side.
// Placeholders are plain alphanumeric so they survive markdown-it and sanitize-html untouched.
function withMath(raw) {
  const chunks = {};
  let counter = 0;

  // Block math: $$...$$ (may span multiple lines)
  let out = raw.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
    const ph = `KATEXPH${counter++}BLK`;
    try {
      chunks[ph] = `<span class="katex-block">${katex.renderToString(tex.trim(), {
        displayMode: true,
        throwOnError: false,
        output: "html",
      })}</span>`;
    } catch (e) {
      chunks[ph] = `<span class="katex-error">$$${escapeHtml(tex)}$$</span>`;
    }
    return ph;
  });

  // Inline math: $...$ (single line, not empty)
  out = out.replace(/\$([^\$\n]+?)\$/g, (_, tex) => {
    const ph = `KATEXPH${counter++}INL`;
    try {
      chunks[ph] = katex.renderToString(tex.trim(), {
        displayMode: false,
        throwOnError: false,
        output: "html",
      });
    } catch (e) {
      chunks[ph] = `<span class="katex-error">${escapeHtml(tex)}</span>`;
    }
    return ph;
  });

  return { mathOut: out, chunks };
}

function restoreMath(html, chunks) {
  return html.replace(/KATEXPH\d+(?:BLK|INL)/g, (ph) => chunks[ph] || ph);
}

function escapeHtml(raw) {
  return String(raw)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseImageMeta(title) {
  if (!title) return null;
  if (!title.startsWith("narfmeta|")) {
    // Backward compatibility for older uploads where title only had caption.
    return {
      align: "right",
      size: "40",
      caption: title,
    };
  }
  const parts = title.split("|").slice(1);
  const map = {};
  for (const part of parts) {
    const [k, ...rest] = part.split("=");
    if (!k || !rest.length) continue;
    map[k.trim()] = rest.join("=").trim();
  }
  const align = ["left", "right", "center"].includes(map.align)
    ? map.align
    : "center";
  const size = ["25", "33", "40", "50", "60", "75", "100"].includes(map.size)
    ? map.size
    : "100";
  const caption = map.caption ? decodeURIComponent(map.caption) : "";
  return { align, size, caption };
}

function withImageLayout(renderedHtml) {
  return renderedHtml.replace(/<img\s+([^>]*?)>/gi, (full, attrs) => {
    const titleMatch = attrs.match(/\stitle="([^"]*)"/i);
    const srcMatch = attrs.match(/\ssrc="([^"]+)"/i);
    if (!titleMatch || !srcMatch) return full;
    const meta = parseImageMeta(titleMatch[1]);
    if (!meta) return full;
    const cleanedImg = full.replace(/\stitle="([^"]*)"/i, "");
    const figcaption = meta.caption
      ? `<figcaption>${escapeHtml(meta.caption)}</figcaption>`
      : "";
    return `<figure class="wiki-image align-${meta.align} size-${meta.size}">${cleanedImg}${figcaption}</figure>`;
  });
}

function renderWiki(content, options = {}) {
  const categories = extractCategories(content);
  const redirectTo = parseRedirect(content);
  const templateApplied = withTemplates(content, options.templateMap || {});
  const linked = withInternalLinks(templateApplied);
  const { infobox, withoutInfobox } = extractInfobox(linked);
  const { replaced, refs } = withReferences(withoutInfobox);
  const withoutCategories = replaced.replace(/\[\[Category:([^\]]+)\]\]/gi, "");

  // Math: extract & render with KaTeX before markdown-it touches the content
  const { mathOut, chunks } = withMath(withoutCategories);

  const rendered = md.render(mathOut);
  const withImageWrappers = withImageLayout(rendered);
  // sanitize-html runs BEFORE restoreMath so KaTeX HTML is never stripped
  const safeHtml = sanitizeHtml(withImageWrappers, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "h1", "h2", "h3", "h4", "h5", "h6",
      "sup", "img", "figure", "figcaption",
    ]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      a: ["href", "name", "target", "id"],
      sup: ["id"],
      figure: ["class"],
      figcaption: ["class"],
      img: ["src", "srcset", "alt", "title", "width", "height", "loading", "class"],
      h1: ["id"], h2: ["id"], h3: ["id"], h4: ["id"], h5: ["id"], h6: ["id"],
    },
  });
  // Restore KaTeX HTML after sanitization — bypasses stripping entirely
  const finalHtml = restoreMath(safeHtml, chunks);

  return {
    html: finalHtml,
    toc: buildToc(safeHtml),
    categories,
    refs,
    infobox,
    redirectTo,
  };
}

module.exports = {
  makeSlug,
  parseRedirect,
  extractCategories,
  renderWiki,
};
