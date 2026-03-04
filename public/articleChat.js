(function () {
  const toggleBtn = document.getElementById("article-chat-toggle");
  const panel = document.getElementById("article-chat-panel");
  const closeBtn = document.getElementById("article-chat-close");
  const form = document.getElementById("article-chat-form");
  const input = document.getElementById("article-chat-input");
  const messages = document.getElementById("article-chat-messages");
  const source = document.getElementById("article-chat-source");
  const titleInput = document.getElementById("article-chat-title");
  const avatarInput = document.getElementById("article-chat-avatar-url");
  if (!toggleBtn || !panel || !form || !input || !messages || !source || !titleInput) {
    return;
  }
  const botAvatarUrl = avatarInput?.value || "";

  function setOpen(open) {
    panel.classList.toggle("hidden", !open);
    if (open) input.focus();
  }

  function appendMessage(role, text) {
    if (role === "bot") {
      const row = document.createElement("div");
      row.className = "article-chat-msg-row bot";
      if (botAvatarUrl) {
        const avatar = document.createElement("img");
        avatar.className = "article-chat-avatar";
        avatar.src = botAvatarUrl;
        avatar.alt = "Bot avatar";
        avatar.addEventListener("error", function () {
          avatar.style.display = "none";
        });
        row.appendChild(avatar);
      }
      const msg = document.createElement("div");
      msg.className = "article-chat-msg bot";
      msg.textContent = text;
      row.appendChild(msg);
      messages.appendChild(row);
    } else {
      const row = document.createElement("div");
      row.className = "article-chat-msg-row user";
      const msg = document.createElement("div");
      msg.className = "article-chat-msg user";
      msg.textContent = text;
      row.appendChild(msg);
      messages.appendChild(row);
    }
    messages.scrollTop = messages.scrollHeight;
  }

  async function askQuestion(question) {
    const response = await fetch("/api/ai/article-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: titleInput.value || "Untitled article",
        content: source.value || "",
        question,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Assistant request failed.");
    }
    return data.answer || "No answer returned.";
  }

  toggleBtn.addEventListener("click", function () {
    setOpen(panel.classList.contains("hidden"));
  });

  closeBtn?.addEventListener("click", function () {
    setOpen(false);
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    const question = input.value.trim();
    if (!question) return;
    appendMessage("user", question);
    input.value = "";
    input.disabled = true;
    appendMessage("bot", "Thinking...");

    try {
      const answer = await askQuestion(question);
      const botMessages = messages.querySelectorAll(".article-chat-msg.bot");
      const loading = botMessages[botMessages.length - 1];
      if (loading && loading.textContent === "Thinking...") {
        loading.textContent = answer;
      } else {
        appendMessage("bot", answer);
      }
    } catch (error) {
      const botMessages = messages.querySelectorAll(".article-chat-msg.bot");
      const loading = botMessages[botMessages.length - 1];
      if (loading && loading.textContent === "Thinking...") {
        loading.textContent = `Error: ${error.message}`;
      } else {
        appendMessage("bot", `Error: ${error.message}`);
      }
    } finally {
      input.disabled = false;
      input.focus();
    }
  });
})();
