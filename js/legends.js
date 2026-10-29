// Collapsible legend cards (rain radar, storm outlook, hurricanes, fires, lakes, flood from space,
// rain totals). Only one card is open at a time, so the map never disappears under legends:
//   - switching a layer on opens its card and folds the others to one-line pills
//   - tapping a pill opens it (and folds the rest); tapping an open card's title folds it
// On phones every card starts folded.
const phone = window.matchMedia("(max-width: 719px)");

export function initLegends() {
  const dock = document.getElementById("legend-dock");
  const cards = () => [...dock.querySelectorAll(".radar-legend")];
  const visible = () => cards().filter((c) => !c.hidden);

  const label = (card) => {
    const folded = card.classList.contains("lg-collapsed");
    const head = card.querySelector(".rl-head");
    if (!head) return;
    head.setAttribute("role", "button");
    head.setAttribute("tabindex", "0");
    head.setAttribute("aria-expanded", String(!folded));
    head.title = folded ? "Show legend" : "Hide legend";
  };
  const setOpen = (card, open) => { card.classList.toggle("lg-collapsed", !open); label(card); };
  const openOnly = (card) => { for (const c of cards()) setOpen(c, c === card); };

  // Start: on phones everything folded; elsewhere only the first visible card open.
  cards().forEach((c, i) => setOpen(c, !phone.matches && c === visible()[0]));

  // Cards re-render their insides (re-label them) and appear when their layer is switched on.
  const seen = new WeakMap(cards().map((c) => [c, !c.hidden]));
  new MutationObserver(() => {
    for (const c of cards()) {
      const was = seen.get(c) ?? false, now = !c.hidden;
      if (now && !was && !phone.matches) openOnly(c);
      else if (now && !was) setOpen(c, false);
      seen.set(c, now);
      label(c);
    }
  }).observe(dock, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });

  const toggle = (card) => (card.classList.contains("lg-collapsed") ? openOnly(card) : setOpen(card, false));
  dock.addEventListener("click", (e) => {
    const head = e.target.closest(".rl-head");
    if (!head || e.target.closest("button")) return; // Pause, day buttons keep working
    toggle(head.closest(".radar-legend"));
  });
  dock.addEventListener("keydown", (e) => {
    const head = e.target.closest?.(".rl-head");
    if (head && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggle(head.closest(".radar-legend")); }
  });
}
