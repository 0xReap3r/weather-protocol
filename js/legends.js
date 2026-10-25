// Collapsible legend cards (rain radar, storm outlook, flood from space, rain totals).
// Tap a card's title row to fold it down to one line. On phones they start folded and sit
// side by side, so the map stays visible. The choice is remembered per card on this device.
const KEY = "stormline.legends.v1";
const phone = window.matchMedia("(max-width: 719px)");

export function initLegends() {
  const dock = document.getElementById("legend-dock");
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (_) {}
  const store = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (_) {} };

  const apply = (card) => {
    if (!card.id) return;
    const folded = card.id in saved ? saved[card.id] : phone.matches;
    card.classList.toggle("lg-collapsed", folded);
    const head = card.querySelector(".rl-head");
    if (head) {
      head.setAttribute("role", "button");
      head.setAttribute("tabindex", "0");
      head.setAttribute("aria-expanded", String(!folded));
      head.title = folded ? "Show legend" : "Hide legend";
    }
  };
  const all = () => dock.querySelectorAll(".radar-legend");
  all().forEach(apply);

  // Cards re-render their insides; re-apply head attributes and pick up cards added later.
  new MutationObserver(() => all().forEach(apply)).observe(dock, { childList: true, subtree: true });

  const toggle = (card) => {
    saved[card.id] = !card.classList.contains("lg-collapsed");
    store();
    apply(card);
  };
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
