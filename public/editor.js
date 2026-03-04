(function () {
  const form = document.getElementById("editor-form");
  const editor = document.getElementById("editor-content");
  const wordCount = document.getElementById("editor-word-count");
  const aiMode = document.getElementById("ai-mode");
  const aiPanel = document.getElementById("ai-generate-panel");
  const aiNotes = document.getElementById("ai-notes");
  const aiStatus = document.getElementById("ai-status");
  const aiGenerateBtn = document.getElementById("ai-generate-article");
  const aiProofreadBtn = document.getElementById("ai-proofread-selection");
  const aiGrammarBtn = document.getElementById("ai-grammar-selection");
  const imageInput = document.getElementById("editor-image-file");
  const imageUploadBtn = document.getElementById("editor-image-upload-btn");
  const imageGalleryBtn = document.getElementById("editor-image-gallery-btn");
  const imageStatus = document.getElementById("editor-image-status");
  const imageDropzone = document.getElementById("editor-image-dropzone");
  const imageAltInput = document.getElementById("editor-image-alt");
  const imageCaptionInput = document.getElementById("editor-image-caption");
  const imageAlignInput = document.getElementById("editor-image-align");
  const imageSizeInput = document.getElementById("editor-image-size");
  const imageGalleryWrap = document.getElementById("editor-image-gallery");
  const imageGallerySearch = document.getElementById("editor-image-gallery-search");
  const imageGalleryList = document.getElementById("editor-image-gallery-list");
  if (!form || !editor) return;
  let galleryCache = [];

  function updateWordCount() {
    const words = (editor.value.trim().match(/\S+/g) || []).length;
    if (wordCount) {
      wordCount.textContent = `${words} word${words === 1 ? "" : "s"}`;
    }
  }

  function insertAtCursor(snippet) {
    const start = editor.selectionStart || 0;
    const end = editor.selectionEnd || 0;
    const before = editor.value.slice(0, start);
    const after = editor.value.slice(end);
    editor.value = `${before}${snippet}${after}`;
    const cursor = start + snippet.length;
    editor.focus();
    editor.setSelectionRange(cursor, cursor);
    updateWordCount();
  }

  document.querySelectorAll(".snippet-btn").forEach((btn) => {
    btn.addEventListener("click", function () {
      const snippet = btn.getAttribute("data-insert") || "";
      insertAtCursor(snippet);
    });
  });

  editor.addEventListener("keydown", function (event) {
    if (event.key === "Tab") {
      event.preventDefault();
      insertAtCursor("  ");
    }
  });

  editor.addEventListener("input", updateWordCount);

  async function rewriteSelection(task) {
    const start = editor.selectionStart || 0;
    const end = editor.selectionEnd || 0;
    const selected = editor.value.slice(start, end).trim();
    if (!selected) {
      alert("Select text in the editor first.");
      return;
    }
    const btn = task === "grammar" ? aiGrammarBtn : aiProofreadBtn;
    if (btn) btn.disabled = true;
    if (aiStatus) aiStatus.textContent = "AI is rewriting selected text...";
    try {
      const response = await fetch("/api/ai/rewrite-selection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: selected, task }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI rewrite failed.");
      const before = editor.value.slice(0, start);
      const after = editor.value.slice(end);
      editor.value = `${before}${data.result}${after}`;
      editor.focus();
      editor.setSelectionRange(start, start + data.result.length);
      updateWordCount();
      if (aiStatus) aiStatus.textContent = "Selected text updated.";
    } catch (error) {
      if (aiStatus) aiStatus.textContent = `Error: ${error.message}`;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function generateArticle() {
    const notes = aiNotes?.value?.trim();
    if (!notes) {
      alert("Add notes/information for AI first.");
      return;
    }
    const titleInput = form.querySelector("input[name='title']");
    const shortDescriptionInput = form.querySelector("input[name='shortDescription']");
    aiGenerateBtn.disabled = true;
    if (aiStatus) aiStatus.textContent = "Generating article draft with GLM-5...";
    try {
      const response = await fetch("/api/ai/generate-article", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: titleInput?.value || "",
          shortDescription: shortDescriptionInput?.value || "",
          notes,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI generation failed.");
      editor.value = data.content || "";
      updateWordCount();
      if (aiStatus) aiStatus.textContent = "Draft generated. Review and edit before saving.";
      editor.focus();
    } catch (error) {
      if (aiStatus) aiStatus.textContent = `Error: ${error.message}`;
    } finally {
      aiGenerateBtn.disabled = false;
    }
  }

  async function uploadImage() {
    const files = Array.from(imageInput?.files || []);
    if (!files.length) {
      alert("Choose one or more images first.");
      return;
    }
    if (imageUploadBtn) imageUploadBtn.disabled = true;
    if (imageStatus) imageStatus.textContent = `Uploading ${files.length} image(s)...`;
    try {
      const formData = new FormData();
      files.forEach((file) => formData.append("images", file));
      formData.append("altText", imageAltInput?.value || "");
      formData.append("caption", imageCaptionInput?.value || "");
      const response = await fetch("/api/media/upload", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Image upload failed.");
      const markdown = (data.files || [])
        .map((f) => buildMarkdown(f.url, f.originalName))
        .join("\n\n");
      insertAtCursor(`\n${markdown}\n`);
      if (imageStatus) imageStatus.textContent = `Uploaded ${data.files.length} image(s).`;
      if (imageInput) imageInput.value = "";
      if (imageGalleryWrap && !imageGalleryWrap.classList.contains("hidden")) {
        await loadGallery(true);
      }
    } catch (error) {
      if (imageStatus) imageStatus.textContent = `Error: ${error.message}`;
    } finally {
      if (imageUploadBtn) imageUploadBtn.disabled = false;
    }
  }

  function humanFileSize(bytes) {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let idx = 0;
    while (value >= 1024 && idx < units.length - 1) {
      value /= 1024;
      idx += 1;
    }
    return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[idx]}`;
  }

  function buildMarkdown(url, originalName) {
    const altRaw = (imageAltInput?.value || "").trim() || originalName || "image";
    const caption = (imageCaptionInput?.value || "").trim();
    const align = (imageAlignInput?.value || "right").trim();
    const size = (imageSizeInput?.value || "40").trim();
    const safeAlt = altRaw.replace(/\]/g, "");
    const safeCaption = caption.replace(/\|/g, "/");
    const meta = `narfmeta|align=${align}|size=${size}|caption=${encodeURIComponent(
      safeCaption
    )}`;
    return `![${safeAlt}](${url} "${meta}")`;
  }

  function renderGallery() {
    if (!imageGalleryList) return;
    const term = (imageGallerySearch?.value || "").trim().toLowerCase();
    const filtered = galleryCache.filter((item) => {
      if (!term) return true;
      return (
        item.originalName.toLowerCase().includes(term) ||
        item.filename.toLowerCase().includes(term) ||
        String(item.uploadedBy || "").toLowerCase().includes(term)
      );
    });
    if (!filtered.length) {
      imageGalleryList.innerHTML = '<p class="editor-muted">No images found.</p>';
      return;
    }
    imageGalleryList.innerHTML = filtered
      .map(
        (item) => `
      <article class="gallery-item">
        <img src="${item.url}" alt="${item.originalName}" loading="lazy" />
        <div class="gallery-item-meta">
          <strong title="${item.originalName}">${item.originalName}</strong>
          <small>${humanFileSize(item.fileSize)} · by ${item.uploadedBy}</small>
          <small>${new Date(item.createdAt).toLocaleString()}</small>
          <button type="button" class="gallery-insert-btn" data-url="${item.url}" data-name="${item.originalName}">Insert</button>
        </div>
      </article>
    `
      )
      .join("");
    imageGalleryList.querySelectorAll(".gallery-insert-btn").forEach((btn) => {
      btn.addEventListener("click", function () {
        const url = btn.getAttribute("data-url");
        const originalName = btn.getAttribute("data-name");
        insertAtCursor(`\n${buildMarkdown(url, originalName)}\n`);
        if (imageStatus) imageStatus.textContent = `Inserted ${originalName}`;
      });
    });
  }

  async function loadGallery(force = false) {
    if (!force && galleryCache.length) {
      renderGallery();
      return;
    }
    if (imageStatus) imageStatus.textContent = "Loading gallery...";
    const response = await fetch("/api/media/list?limit=150");
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Failed to load gallery.");
    }
    galleryCache = data.files || [];
    renderGallery();
    if (imageStatus) imageStatus.textContent = `Loaded ${galleryCache.length} image(s).`;
  }

  async function toggleGallery() {
    if (!imageGalleryWrap) return;
    const willShow = imageGalleryWrap.classList.contains("hidden");
    imageGalleryWrap.classList.toggle("hidden", !willShow);
    if (willShow) {
      try {
        await loadGallery();
      } catch (error) {
        if (imageStatus) imageStatus.textContent = `Error: ${error.message}`;
      }
    }
  }

  function setupDropzone() {
    if (!imageDropzone) return;
    ["dragenter", "dragover"].forEach((eventName) => {
      imageDropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        imageDropzone.classList.add("is-dragover");
      });
    });
    ["dragleave", "drop"].forEach((eventName) => {
      imageDropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        imageDropzone.classList.remove("is-dragover");
      });
    });
    imageDropzone.addEventListener("drop", async (event) => {
      const files = Array.from(event.dataTransfer?.files || []).filter((file) =>
        file.type.startsWith("image/")
      );
      if (!files.length) {
        if (imageStatus) imageStatus.textContent = "Drop image files only.";
        return;
      }
      const transfer = new DataTransfer();
      files.forEach((file) => transfer.items.add(file));
      if (imageInput) imageInput.files = transfer.files;
      await uploadImage();
    });
  }

  if (aiMode) {
    aiMode.addEventListener("change", function () {
      const useAi = aiMode.value === "ai";
      aiPanel?.classList.toggle("hidden", !useAi);
      if (aiStatus) aiStatus.textContent = "";
    });
  }
  aiProofreadBtn?.addEventListener("click", function () {
    rewriteSelection("proofread");
  });
  aiGrammarBtn?.addEventListener("click", function () {
    rewriteSelection("grammar");
  });
  aiGenerateBtn?.addEventListener("click", generateArticle);
  imageUploadBtn?.addEventListener("click", uploadImage);
  imageGalleryBtn?.addEventListener("click", toggleGallery);
  imageGallerySearch?.addEventListener("input", renderGallery);
  setupDropzone();

  updateWordCount();
})();
