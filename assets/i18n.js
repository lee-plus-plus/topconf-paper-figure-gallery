/* ===== Shared i18n core for gallery & FigureForge =====
 * Usage: GAL_I18N.register({en:{...},zh:{...}}) once per page;
 * tag static nodes with data-i18n / data-i18n-html / data-i18n-ph / data-i18n-aria.
 * Preference is shared across gallery and forge via localStorage key "figgal.lang".
 */
(function () {
  "use strict";
  const STORE_KEY = "figgal.lang";
  const bundles = { en: {}, zh: {} };
  const LANGS = ["en", "zh"];

  function detectLang() {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (LANGS.includes(saved)) return saved;
    } catch (_) { /* private mode */ }
    return (navigator.language || "zh").toLowerCase().startsWith("zh") ? "zh" : "en";
  }

  let lang = detectLang();

  function t(key, vars) {
    let s = (bundles[lang] && bundles[lang][key]) || (bundles.en[key]) || key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
    return s;
  }

  function apply(root) {
    (root || document).querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    (root || document).querySelectorAll("[data-i18n-html]").forEach((el) => {
      el.innerHTML = t(el.dataset.i18nHtml);
    });
    (root || document).querySelectorAll("[data-i18n-ph]").forEach((el) => {
      el.setAttribute("placeholder", t(el.dataset.i18nPh));
    });
    (root || document).querySelectorAll("[data-i18n-aria]").forEach((el) => {
      el.setAttribute("aria-label", t(el.dataset.i18nAria));
    });
    (root || document).querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.setAttribute("title", t(el.dataset.i18nTitle));
    });
  }

  function setLang(next) {
    if (!LANGS.includes(next) || next === lang) return;
    lang = next;
    try { localStorage.setItem(STORE_KEY, next); } catch (_) { /* ignore */ }
    document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
    apply();
    document.dispatchEvent(new CustomEvent("langchange", { detail: { lang: next } }));
  }

  window.GAL_I18N = {
    register(dict) {
      LANGS.forEach((l) => Object.assign(bundles[l], dict[l] || {}));
    },
    t,
    apply,
    setLang,
    get lang() { return lang; },
  };
})();
