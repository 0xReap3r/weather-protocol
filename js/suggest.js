// Suggestion box: a lightweight way for the community to send ideas, bug reports and data
// corrections. It's a community page, so this has to be no-hassle for people to use and for us
// to run — it posts to Netlify Forms, which needs no server or database of our own.
//
// Netlify only detects a form if a plain <form data-netlify="true"> with this same `name` exists
// in the static HTML at build time — it can't see one a script builds at runtime. That static,
// hidden copy lives in index.html (name="suggestions", same field names as below) purely so
// Netlify's bot finds it; this module's visible form posts to it over fetch instead of a page
// reload, and is what people actually see and fill in.
// NOTE: submissions only land in the Netlify dashboard once the site is actually served by
// Netlify — a local dev server or another host will show the "couldn't send" message instead.
import { t } from "./i18n.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const CATEGORIES = [
  ["idea", "Feature idea"],
  ["bug", "Something's wrong"],
  ["data", "A data source or reading looks off"],
  ["other", "Something else"],
];

export function initSuggest({ openSheet, closeSheet, toast }) {
  const root = document.getElementById("suggest-body");
  let draft = { category: "idea", message: "", contact: "" };
  let sending = false;

  function render() {
    root.innerHTML = `
      <p class="sheet-lead">StormFront is built for Texans, by neighbors. Tell us what's missing, what's wrong, or what would help — we read every one.</p>
      <h3 class="rp-h">What's this about?</h3>
      <div class="sg-cats">${CATEGORIES.map(
        ([k, l]) => `<button type="button" class="sg-cat" data-cat="${k}" aria-pressed="${draft.category === k}">${esc(t(l))}</button>`
      ).join("")}</div>
      <h3 class="rp-h">Your suggestion</h3>
      <textarea id="sg-message" class="sg-textarea" maxlength="1000" placeholder="${esc(t("What would make this map better for you?"))}" aria-label="${esc(t("Your suggestion"))}" ${sending ? "disabled" : ""}>${esc(draft.message)}</textarea>
      <h3 class="rp-h">Email <span class="sg-optional">(${esc(t("optional, if you'd like a reply"))})</span></h3>
      <input id="sg-contact" class="place-input sg-contact" type="email" maxlength="120" placeholder="you@example.com" value="${esc(draft.contact)}" aria-label="${esc(t("Your email, optional"))}" translate="no" ${sending ? "disabled" : ""}>
      <button type="button" class="rp-send" id="sg-send" ${draft.message.trim() && !sending ? "" : "disabled"}>${sending ? t("Sending…") : t("Send suggestion")}</button>
      <p class="rp-note">${t("Goes straight to the people who run StormFront. We won't share it or use your email for anything else.")}</p>`;
  }

  root.addEventListener("input", (e) => {
    if (e.target.id === "sg-message") {
      draft.message = e.target.value;
      const btn = root.querySelector("#sg-send");
      if (btn) btn.disabled = !draft.message.trim();
    }
    if (e.target.id === "sg-contact") draft.contact = e.target.value;
  });

  root.addEventListener("click", async (e) => {
    const c = e.target.closest("[data-cat]");
    if (c) { draft.category = c.dataset.cat; render(); return; }
    if (e.target.closest("#sg-send") && !sending) {
      if (!draft.message.trim()) return;
      sending = true;
      render();
      try {
        const res = await fetch("/", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            "form-name": "suggestions",
            category: CATEGORIES.find(([k]) => k === draft.category)?.[1] || draft.category,
            message: draft.message.trim(),
            contact: draft.contact.trim(),
          }).toString(),
        });
        if (!res.ok) throw new Error();
        draft = { category: "idea", message: "", contact: "" };
        sending = false;
        closeSheet();
        toast(t("Thanks — your suggestion is on its way."));
      } catch (_) {
        sending = false;
        render();
        toast(t("Couldn't send that. Check your connection and try again."));
      }
    }
  });

  function open() {
    draft = { category: "idea", message: "", contact: "" };
    sending = false;
    render();
    openSheet("suggest", t("Suggestion box"));
  }

  return { open };
}
