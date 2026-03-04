const OpenAI = require("openai");
const config = require("../config");

let cachedClient = null;

function getClient() {
  if (!config.glmApiKey) {
    throw new Error("GLM_API_KEY is missing.");
  }
  if (!cachedClient) {
    cachedClient = new OpenAI({
      apiKey: config.glmApiKey,
      baseURL: config.glmBaseUrl,
    });
  }
  return cachedClient;
}

async function chat(messages, temperature = 0.2) {
  const client = getClient();
  const response = await client.chat.completions.create({
    model: config.glmModel,
    messages,
    temperature,
  });
  return response.choices?.[0]?.message?.content?.trim() || "";
}

async function rewriteSelection(text, task) {
  const system =
    "You are an expert wiki editor. Return only revised text with no intro or markdown fences.";
  const user =
    task === "grammar"
      ? `Fix grammar, punctuation, and clarity while preserving meaning:\n\n${text}`
      : `Proofread and improve readability while preserving meaning and original tone:\n\n${text}`;
  return chat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    0.15
  );
}

async function generateArticle({ title, notes, shortDescription }) {
  const system =
    "You write structured, neutral encyclopedic wiki articles in Markdown. Include section headings and concise factual style. Do not add unsupported claims.";
  const user = `Create a wiki article draft.

Title: ${title || "Untitled"}
Short description: ${shortDescription || "N/A"}
Source notes and instructions:
${notes}

Output format requirements:
- Use Markdown headings.
- Include an introductory paragraph.
- Include at least 3 sections if possible.
- Include optional wiki links like [[Page Name]] when relevant.
- Add category tags at bottom if obvious using [[Category:...]].
- Return only article content.`;

  return chat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    0.3
  );
}

async function answerArticleQuestion({ title, content, question }) {
  const system = `You are a concise article assistant for a private wiki.
Rules:
- Answer only from the provided article content.
- Keep answers short: max 2 sentences, or up to 3 bullets when needed.
- If the answer is not in the article, say: "This is not mentioned in the article."
- Do not invent facts and do not use external knowledge.`;

  const user = `Article title: ${title}

Article content:
${content}

User question:
${question}

Return a concise answer.`;

  return chat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    0.1
  );
}

async function didYouKnow({ title, content }) {
  const system = `You are a curious wiki assistant that finds the single most interesting, surprising, or non-obvious fact hidden inside an article.
Rules:
- Return ONE sentence only. Start it with "Did you know" and end with a period.
- The fact must come directly from the article content.
- Make it feel genuinely interesting, not bland or obvious.
- Do not add quotation marks or markdown.`;

  const user = `Article title: ${title}

Article content (may be truncated):
${content.slice(0, 6000)}

Return the single most interesting "Did you know..." sentence from this article.`;

  return chat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    0.5
  );
}

module.exports = {
  rewriteSelection,
  generateArticle,
  answerArticleQuestion,
  didYouKnow,
};
