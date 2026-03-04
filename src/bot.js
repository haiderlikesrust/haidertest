const express = require("express");
const config = require("./config");
const { query } = require("./db");

const app = express();
app.use(express.json());

const webBaseUrl = process.env.WEB_BASE_URL || "http://localhost:3000";
const optionalPin = process.env.WHATSAPP_BOT_PIN || "";
const pinVerified = new Set();

function normalizePhone(phone) {
  return String(phone || "").replace(/[^\d]/g, "");
}

function isWhitelisted(phone) {
  const normalized = normalizePhone(phone);
  return config.whitelistedPhones.includes(normalized);
}

function isAuthorized(phone) {
  if (!isWhitelisted(phone)) return false;
  if (!optionalPin) return true;
  return pinVerified.has(normalizePhone(phone));
}

async function sendWhatsAppText(to, body) {
  if (!config.whatsappBotToken || !config.whatsappPhoneNumberId) {
    console.log(`[BOT->${to}] ${body}`);
    return;
  }

  await fetch(
    `https://graph.facebook.com/v21.0/${config.whatsappPhoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.whatsappBotToken}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        text: { body: body.slice(0, 4096) },
      }),
    }
  );
}

async function callWiki(path, method = "GET", payload) {
  const response = await fetch(`${webBaseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.botApiToken}`,
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Wiki API request failed");
  }
  return data;
}

async function getBotSession(phone) {
  const result = await query(
    "SELECT * FROM bot_sessions WHERE phone_number = $1",
    [phone]
  );
  return result.rows[0] || null;
}

async function saveBotSession(phone, title, mode, buffer = "") {
  await query(
    `INSERT INTO bot_sessions (phone_number, active_title, mode, buffer, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (phone_number)
     DO UPDATE SET active_title = EXCLUDED.active_title, mode = EXCLUDED.mode, buffer = EXCLUDED.buffer, updated_at = NOW()`,
    [phone, title, mode, buffer]
  );
}

async function clearBotSession(phone) {
  await query("DELETE FROM bot_sessions WHERE phone_number = $1", [phone]);
}

function parseCommand(text) {
  const parts = text.trim().split(/\s+/);
  const command = parts[0]?.toLowerCase() || "";
  const rest = text.trim().slice(command.length).trim();
  return { command, rest };
}

async function handleCommand(from, text) {
  const normalizedPhone = normalizePhone(from);
  if (!isWhitelisted(normalizedPhone)) {
    await sendWhatsAppText(from, "Unauthorized phone number.");
    return;
  }

  if (optionalPin && !pinVerified.has(normalizedPhone)) {
    const { command, rest } = parseCommand(text);
    if (command !== "/auth") {
      await sendWhatsAppText(from, "PIN required. Use /auth <pin>.");
      return;
    }
    if (rest === optionalPin) {
      pinVerified.add(normalizedPhone);
      await sendWhatsAppText(from, "Authentication successful.");
    } else {
      await sendWhatsAppText(from, "Invalid PIN.");
    }
    return;
  }

  const session = await getBotSession(normalizedPhone);
  const { command, rest } = parseCommand(text);

  if (command === "/done") {
    if (!session) {
      await sendWhatsAppText(from, "No active edit session.");
      return;
    }
    const summary = "WhatsApp update";
    if (session.mode === "create") {
      await callWiki("/api/bot/create", "POST", {
        title: session.active_title,
        content: session.buffer.trim(),
        summary,
      });
    } else if (session.mode === "update") {
      await callWiki("/api/bot/update", "POST", {
        title: session.active_title,
        content: session.buffer.trim(),
        summary,
        mode: "replace",
      });
    } else {
      await callWiki("/api/bot/update", "POST", {
        title: session.active_title,
        content: session.buffer.trim(),
        summary,
        mode: "append",
      });
    }
    await clearBotSession(normalizedPhone);
    await sendWhatsAppText(
      from,
      `Saved "${session.active_title}" from WhatsApp session.`
    );
    return;
  }

  if (session && !command.startsWith("/")) {
    const nextBuffer = `${session.buffer}\n${text}`.trim();
    await saveBotSession(
      normalizedPhone,
      session.active_title,
      session.mode,
      nextBuffer
    );
    await sendWhatsAppText(
      from,
      `Buffered content for "${session.active_title}". Send /done when finished.`
    );
    return;
  }

  try {
    if (command === "/search") {
      const data = await callWiki(`/api/bot/search?q=${encodeURIComponent(rest)}`);
      if (!data.results.length) {
        await sendWhatsAppText(from, "No results.");
        return;
      }
      const lines = data.results
        .slice(0, 5)
        .map((r) => `- ${r.title} (${r.slug})`);
      await sendWhatsAppText(from, `Results:\n${lines.join("\n")}`);
      return;
    }
    if (command === "/read") {
      const data = await callWiki(`/api/bot/read?title=${encodeURIComponent(rest)}`);
      const excerpt = (data.content || "").slice(0, 1200);
      await sendWhatsAppText(
        from,
        `*${data.title}*\nCategories: ${data.categories.join(", ") || "none"}\n\n${excerpt}`
      );
      return;
    }
    if (command === "/create") {
      await saveBotSession(normalizedPhone, rest, "create", "");
      await sendWhatsAppText(from, `Send content for "${rest}". End with /done.`);
      return;
    }
    if (command === "/update") {
      await saveBotSession(normalizedPhone, rest, "update", "");
      await sendWhatsAppText(
        from,
        `Send new full content for "${rest}". End with /done.`
      );
      return;
    }
    if (command === "/append") {
      await saveBotSession(normalizedPhone, rest, "append", "");
      await sendWhatsAppText(
        from,
        `Send text to append to "${rest}". End with /done.`
      );
      return;
    }
    if (command === "/delete") {
      await callWiki("/api/bot/delete", "POST", { title: rest });
      await sendWhatsAppText(from, `Deleted "${rest}".`);
      return;
    }
    if (command === "/history") {
      const data = await callWiki(
        `/api/bot/history?title=${encodeURIComponent(rest)}`
      );
      const lines = data.revisions
        .slice(0, 8)
        .map((r) => `#${r.id} ${new Date(r.created_at).toISOString()} ${r.username || "system"} - ${r.summary}`);
      await sendWhatsAppText(from, `${data.title} history:\n${lines.join("\n")}`);
      return;
    }
    if (command === "/diff") {
      const bits = rest.split(/\s+/);
      if (bits.length < 3) {
        await sendWhatsAppText(from, "Usage: /diff <title> <revA> <revB>");
        return;
      }
      const revB = bits.pop();
      const revA = bits.pop();
      const title = bits.join(" ");
      const data = await callWiki(
        `/api/bot/diff?title=${encodeURIComponent(title)}&revA=${encodeURIComponent(
          revA
        )}&revB=${encodeURIComponent(revB)}`
      );
      const lines = data.diff
        .slice(0, 80)
        .map((part) => {
          if (part.added) return `+ ${part.value}`;
          if (part.removed) return `- ${part.value}`;
          return `  ${part.value}`;
        })
        .join("")
        .slice(0, 1500);
      await sendWhatsAppText(from, `Diff ${title} (${revA} vs ${revB}):\n${lines}`);
      return;
    }
    if (command === "/categories") {
      const data = await callWiki(
        `/api/bot/categories?title=${encodeURIComponent(rest)}`
      );
      await sendWhatsAppText(
        from,
        `${data.title} categories: ${data.categories.join(", ") || "none"}`
      );
      return;
    }
    if (command === "/setcategory") {
      const parts = rest.split(/\s+/);
      if (parts.length < 2) {
        await sendWhatsAppText(
          from,
          "Usage: /setcategory <title> <CategoryName>"
        );
        return;
      }
      const category = parts.pop();
      const title = parts.join(" ");
      await callWiki("/api/bot/setcategory", "POST", { title, category });
      await sendWhatsAppText(from, `Added category "${category}" to "${title}".`);
      return;
    }

    await sendWhatsAppText(
      from,
      "Commands: /search /read /create /update /append /delete /history /diff /categories /setcategory /done"
    );
  } catch (error) {
    await sendWhatsAppText(from, `Command failed: ${error.message}`);
  }
}

app.get("/healthz", (_, res) => res.json({ ok: true }));

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === config.whatsappVerifyToken) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    const entries = req.body.entry || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const messages = change.value?.messages || [];
        for (const msg of messages) {
          const from = msg.from;
          const text = msg.text?.body || "";
          if (from && text) {
            await handleCommand(from, text);
          }
        }
      }
    }
  } catch (error) {
    console.error("Webhook handling failed:", error);
  }
  return res.sendStatus(200);
});

app.listen(config.botPort, () => {
  console.log(`NARFwiki bot listening on port ${config.botPort}`);
});
