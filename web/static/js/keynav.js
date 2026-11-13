const FORM_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT", "BUTTON"]);

function isFormTarget(event) {
  const t = event.target;
  if (!t || !t.tagName) return false;
  return FORM_TAGS.has(t.tagName) || t.isContentEditable;
}

function isListPage() {
  const route = (location.hash || "").split("?")[0];
  return route === "#/problems" || route === "#/premium";
}

function listCards() {
  return Array.from(document.querySelectorAll(".problem-list .problem-card"));
}

function cardHref(card) {
  const link = card.querySelector("a.card-title");
  return link ? link.getAttribute("href") : null;
}

let selectedHref = null;

function selectedIndex(cards) {
  if (selectedHref === null) return -1;
  return cards.findIndex((card) => cardHref(card) === selectedHref);
}

function setSelected(cards, index) {
  cards.forEach((card) => card.classList.remove("keynav-selected"));
  if (index < 0 || index >= cards.length) {
    selectedHref = null;
    return;
  }
  const card = cards[index];
  card.classList.add("keynav-selected");
  selectedHref = cardHref(card);
  card.scrollIntoView({ block: "nearest" });
}

function clearSelected() {
  selectedHref = null;
  document.querySelectorAll(".keynav-selected").forEach((card) => {
    card.classList.remove("keynav-selected");
  });
}

export function initKeyboardShortcuts() {
  document.addEventListener("keydown", (event) => {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;

    if (event.key === "r" && !isFormTarget(event)) {
      const route = (location.hash || "").split("?")[0];
      location.hash = route === "#/premium" ? "#/problems?random=1&paid=1" : "#/problems?random=1";
      event.preventDefault();
      return;
    }

    if (!isListPage()) return;

    if (event.key === "/" && !isFormTarget(event)) {
      const search = document.querySelector('input[type="search"]');
      if (search) {
        event.preventDefault();
        search.focus();
      }
      return;
    }

    if (event.key === "Escape") {
      const search = document.querySelector('input[type="search"]');
      if (search && document.activeElement === search) {
        search.blur();
        return;
      }
      if (selectedHref !== null) clearSelected();
      return;
    }

    if (event.key === "j" || event.key === "k") {
      if (isFormTarget(event)) return;
      const cards = listCards();
      if (!cards.length) return;
      const index = selectedIndex(cards);
      let next;
      if (index < 0) {
        next = event.key === "j" ? 0 : cards.length - 1;
      } else {
        next = event.key === "j" ? Math.min(index + 1, cards.length - 1) : Math.max(index - 1, 0);
      }
      event.preventDefault();
      setSelected(cards, next);
      return;
    }

    if (event.key === "Enter" && !isFormTarget(event) && selectedHref !== null) {
      const cards = listCards();
      const index = selectedIndex(cards);
      if (index < 0) {
        clearSelected();
        return;
      }
      event.preventDefault();
      location.hash = cardHref(cards[index]);
    }
  });

  const app = document.getElementById("app");
  if (!app) return;
  const observer = new MutationObserver(() => {
    if (selectedHref === null) return;
    const cards = listCards();
    const index = selectedIndex(cards);
    if (index < 0) return;
    const card = cards[index];
    if (!card.classList.contains("keynav-selected")) card.classList.add("keynav-selected");
  });
  observer.observe(app, { childList: true, subtree: true });
}
