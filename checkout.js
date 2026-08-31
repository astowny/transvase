/*
 * checkout.js — custom Stripe checkout + lead-form wiring.
 *
 * This file is shared BYTE-FOR-BYTE between the cadran-seo and transvase
 * repositories (spec: sharing-is-byte-identity-not-a-package). It therefore
 * contains nothing site-specific:
 *   - plan ids come from the [data-plan] attribute of the clicked button;
 *   - amounts, labels, the publishable key and the return url come from
 *     POST /api/checkout;
 *   - colours, radius and font stacks come from the page's own CSS custom
 *     properties (spec: appearance-from-the-pages-own-tokens);
 *   - every user-visible string exists here in French and English, selected
 *     by document.documentElement.lang.
 *
 * The page's only obligations are the two bindings of the interface contract:
 *   BINDING 1  <button type="button" class="…" data-plan="<planId>">…</button>
 *   BINDING 2  <form data-lead> with no onsubmit attribute
 * This file injects its own modal DOM and its own <style>; the pages carry no
 * modal markup, no #payment-element container and no checkout CSS.
 *
 * Stripe.js is loaded by the page in <head>, not by this file.
 */
(function () {
  "use strict";

  /* ==========================================================================
   * 1. Strings — French and English side by side so they cannot drift.
   * ======================================================================= */

  var STRINGS = {
    fr: {
      dialogLabel: "Paiement",
      close: "Fermer",
      emailTitle: "Votre adresse e-mail",
      emailHint: "Elle sert au reçu du paiement et au suivi de la commande.",
      emailPlaceholder: "prenom@entreprise.fr",
      emailInvalid: "Cette adresse e-mail ne semble pas valide.",
      continue: "Continuer",
      preparing: "Préparation du paiement…",
      pay: "Payer {amount}",
      payPlain: "Payer",
      paying: "Paiement en cours…",
      testNotice: "Mode test — aucun paiement réel n'est encaissé.",
      errorNetwork:
        "La connexion au serveur a échoué. Vérifiez votre connexion et réessayez.",
      errorServer:
        "Le serveur n'a pas pu préparer ce paiement. Réessayez dans un instant.",
      errorRateLimited:
        "Trop de tentatives depuis cette connexion. Réessayez dans quelques minutes.",
      errorStripeMissing:
        "Le module de paiement n'a pas pu être chargé (bloqueur de contenu ou réseau filtré). Le paiement est impossible depuis ce navigateur.",
      errorElementLoad:
        "Le formulaire de carte n'a pas pu s'afficher. C'est souvent un bloqueur de contenu ou un réseau qui filtre js.stripe.com.",
      errorUnexpected: "Une erreur inattendue s'est produite. Réessayez.",
      contactHint: "Si le problème persiste, écrivez-nous depuis le formulaire de la page.",
      contactLink: "Aller au formulaire",
      receiptTitle: "Paiement confirmé",
      receiptProcessingTitle: "Paiement en cours de traitement",
      receiptProcessingBody:
        "La banque n'a pas encore rendu sa réponse. Vous n'avez rien d'autre à faire.",
      receiptUnknownTitle: "Paiement non relu",
      receiptUnknownBody:
        "Ce paiement ne peut pas être relu depuis cet onglet. Rien n'est perdu : le reçu part par e-mail.",
      receiptTestNote: "Mode test — aucun argent n'a été débité.",
      labelPlan: "Prestation",
      labelAmount: "Montant",
      labelReference: "Référence",
      labelEmail: "Reçu envoyé à",
      emailWrong: "Adresse incorrecte ? Signalez-le avec le formulaire de la page.",
      done: "Terminer",
      leadSending: "Envoi…",
      leadSuccess: "Demande envoyée ✓",
      leadSuccessBody: "C'est enregistré. Vous recevez une réponse par e-mail.",
      leadError: "L'envoi a échoué. Réessayez dans un instant.",
      leadRateLimited:
        "Trop d'envois depuis cette connexion. Réessayez dans quelques minutes."
    },
    en: {
      dialogLabel: "Payment",
      close: "Close",
      emailTitle: "Your email address",
      emailHint: "Used for the payment receipt and order follow-up.",
      emailPlaceholder: "you@company.com",
      emailInvalid: "That email address does not look valid.",
      continue: "Continue",
      preparing: "Preparing payment…",
      pay: "Pay {amount}",
      payPlain: "Pay",
      paying: "Payment in progress…",
      testNotice: "Test mode — no real payment is taken.",
      errorNetwork:
        "The connection to the server failed. Check your connection and try again.",
      errorServer:
        "The server could not prepare this payment. Try again in a moment.",
      errorRateLimited:
        "Too many attempts from this connection. Try again in a few minutes.",
      errorStripeMissing:
        "The payment module could not load (content blocker or filtered network). Paying from this browser is not possible.",
      errorElementLoad:
        "The card form could not be displayed. This is usually a content blocker or a network filtering js.stripe.com.",
      errorUnexpected: "Something unexpected went wrong. Please try again.",
      contactHint: "If it keeps failing, write to us using the form on this page.",
      contactLink: "Go to the form",
      receiptTitle: "Payment confirmed",
      receiptProcessingTitle: "Payment being processed",
      receiptProcessingBody:
        "The bank has not answered yet. There is nothing else for you to do.",
      receiptUnknownTitle: "Payment not readable here",
      receiptUnknownBody:
        "This payment cannot be read back from this tab. Nothing is lost: the receipt is sent by email.",
      receiptTestNote: "Test mode — no money has been charged.",
      labelPlan: "Plan",
      labelAmount: "Amount",
      labelReference: "Reference",
      labelEmail: "Receipt sent to",
      emailWrong: "Wrong address? Tell us using the form on this page.",
      done: "Done",
      leadSending: "Sending…",
      leadSuccess: "Request sent ✓",
      leadSuccessBody: "Recorded. You will get an answer by email.",
      leadError: "Sending failed. Try again in a moment.",
      leadRateLimited:
        "Too many submissions from this connection. Try again in a few minutes."
    }
  };

  /* ==========================================================================
   * 2. Constants and small helpers.
   * ======================================================================= */

  var CHECKOUT_URL = "/api/checkout";
  var LEAD_URL = "/api/lead";
  var REQUEST_TIMEOUT_MS = 20000;
  var ELEMENT_MIN_HEIGHT = "320px";
  var ELEMENT_READY_TIMEOUT_MS = 15000;
  /* font-size-base-stays-16px: 14px reintroduces iOS auto-zoom inside the
   * card field, which is exactly where a zoom jump hurts most. */
  var ELEMENT_FONT_SIZE = "16px";
  /* Both target sites draw square inputs unless they declare a radius token,
   * so an absent token means "sharp", not "Stripe's 5px default". A site with
   * rounded inputs must expose one of RADIUS_TOKENS. */
  var RADIUS_FALLBACK = "0px";
  var SESSION_KEY = "devanchor.checkout";
  var TITLE_ID = "dvc-title";

  /* CSS custom properties, in priority order, read off :root. The two sites
   * use different names for the same role, so every role is a chain and an
   * absent chain means "let Stripe keep its default" rather than a literal. */
  var TOKENS = {
    /* cadran-seo: --signal (orange)   transvase: --flow (green) */
    primary: ["--signal", "--flow", "--spark", "--accent"],
    /* text drawn on top of the primary colour */
    onPrimary: ["--signal-ink", "--on-flow", "--paper", "--bg", "--card", "--surface"],
    text: ["--ink", "--text"],
    textSecondary: ["--ink-2", "--ink-3", "--text-2"],
    /* the background of a form field: cadran-seo --paper, transvase --surface */
    inputBackground: ["--paper", "--surface", "--card", "--bg"],
    /* the background of the panel a form sits on: cadran-seo --card, transvase --bg */
    sheetBackground: ["--card", "--bg", "--surface", "--paper"],
    border: ["--rule", "--edge", "--border"],
    /* cadran-seo has no dedicated danger token; --signal doubles as its alarm
     * colour, which is why it appears last in this chain and not first. */
    danger: ["--drop", "--danger", "--error", "--signal"],
    radius: ["--r", "--radius", "--radius-md", "--border-radius"]
  };

  var FOCUSABLE =
    'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),' +
    'textarea:not([disabled]),iframe,[tabindex]:not([tabindex="-1"])';

  function locale() {
    var lang = (document.documentElement.getAttribute("lang") || "").toLowerCase();
    return lang.indexOf("en") === 0 ? "en" : "fr";
  }

  function t(key) {
    var table = STRINGS[locale()] || STRINGS.fr;
    return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    /* text-content-never-inner-html: every value that reaches the DOM goes
     * through textContent, including our own strings. */
    if (text != null) node.textContent = String(text);
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /* Guards. This is JavaScript, so the "no any" rule becomes: never touch a
   * field of a response shape without checking it first. */
  function isObject(value) {
    return typeof value === "object" && value !== null;
  }

  function str(value) {
    return typeof value === "string" && value.length > 0 ? value : null;
  }

  function looksLikeEmail(value) {
    if (typeof value !== "string") return false;
    var v = value.trim();
    if (v.length === 0 || v.length > 254) return false;
    if (/[\r\n]/.test(v)) return false;
    return v.split("@").length === 2 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
  }

  /* Session cache: the publishable key and the labels of the intent created in
   * this tab. The return landing (§8 return-landing-is-the-same-page) needs a
   * publishable key to build a Stripe instance, and no route serves one on a
   * plain page load — see the report. sessionStorage survives the 3DS redirect
   * because the redirect comes back into the same tab. */
  function sessionRead() {
    try {
      var raw = window.sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return isObject(parsed) ? parsed : null;
    } catch (err) {
      return null;
    }
  }

  function sessionWrite(value) {
    try {
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
    } catch (err) {
      /* Private mode or storage disabled: the in-place success branch still
       * works; only the redirect landing loses its labels. */
    }
  }

  /* ==========================================================================
   * 3. Design tokens → Stripe appearance.
   * ======================================================================= */

  /* Only colour syntaxes Stripe can parse are forwarded. A token holding
   * color-mix(), var() or a keyword is dropped rather than passed on, because
   * an unparsable appearance value makes elements() throw and takes the whole
   * checkout down with it. */
  function isColour(value) {
    if (typeof value !== "string") return false;
    var v = value.trim();
    if (/^#[0-9a-f]{3,8}$/i.test(v)) return true;
    return /^(rgb|rgba|hsl|hsla)\(/i.test(v);
  }

  function hexToRgba(value, alpha) {
    var v = String(value).trim();
    var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
    if (!m) return null;
    var hex = m[1];
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    var n = parseInt(hex, 16);
    /* eslint-disable no-bitwise */
    var r = (n >> 16) & 255;
    var g = (n >> 8) & 255;
    var b = n & 255;
    /* eslint-enable no-bitwise */
    return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
  }

  function readTokens() {
    var rootStyle = window.getComputedStyle(document.documentElement);
    /* The spec says to read the font stacks off documentElement. Neither site
     * declares font-family on <html> — both declare it on <body> — so reading
     * documentElement alone returns the browser's default serif. body first,
     * documentElement as the fallback. Reported. */
    var bodyStyle = document.body
      ? window.getComputedStyle(document.body)
      : rootStyle;

    function pick(names) {
      for (var i = 0; i < names.length; i++) {
        var value = rootStyle.getPropertyValue(names[i]);
        if (value && value.trim()) return value.trim();
      }
      return "";
    }

    function colour(names) {
      var value = pick(names);
      return isColour(value) ? value : "";
    }

    return {
      primary: colour(TOKENS.primary),
      onPrimary: colour(TOKENS.onPrimary),
      text: colour(TOKENS.text),
      textSecondary: colour(TOKENS.textSecondary),
      inputBackground: colour(TOKENS.inputBackground),
      sheetBackground: colour(TOKENS.sheetBackground),
      border: colour(TOKENS.border),
      danger: colour(TOKENS.danger),
      radius: pick(TOKENS.radius) || RADIUS_FALLBACK,
      font: (bodyStyle.fontFamily || rootStyle.fontFamily || "").trim()
    };
  }

  function buildAppearance(tokens) {
    var variables = { fontSizeBase: ELEMENT_FONT_SIZE };
    if (tokens.primary) variables.colorPrimary = tokens.primary;
    if (tokens.inputBackground) variables.colorBackground = tokens.inputBackground;
    if (tokens.text) variables.colorText = tokens.text;
    if (tokens.textSecondary) variables.colorTextSecondary = tokens.textSecondary;
    if (tokens.danger) variables.colorDanger = tokens.danger;
    if (tokens.font) variables.fontFamily = tokens.font;
    if (tokens.radius) variables.borderRadius = tokens.radius;

    var rules = {};
    var input = { boxShadow: "none", fontSize: ELEMENT_FONT_SIZE };
    if (tokens.inputBackground) input.backgroundColor = tokens.inputBackground;
    if (tokens.text) input.color = tokens.text;
    if (tokens.border) input.border = "1px solid " + tokens.border;
    if (tokens.radius) input.borderRadius = tokens.radius;
    rules[".Input"] = input;

    var focus = {};
    if (tokens.primary) {
      focus.borderColor = tokens.primary;
      var ring = hexToRgba(tokens.primary, 0.22);
      focus.boxShadow = ring ? "0 0 0 3px " + ring : "none";
    } else {
      focus.boxShadow = "none";
    }
    rules[".Input:focus"] = focus;

    var label = { fontSize: "13px", fontWeight: "500" };
    if (tokens.textSecondary) label.color = tokens.textSecondary;
    rules[".Label"] = label;

    var tab = { fontSize: "14px" };
    if (tokens.inputBackground) tab.backgroundColor = tokens.inputBackground;
    if (tokens.text) tab.color = tokens.text;
    if (tokens.border) tab.border = "1px solid " + tokens.border;
    if (tokens.radius) tab.borderRadius = tokens.radius;
    rules[".Tab"] = tab;

    var tabSelected = {};
    if (tokens.primary) {
      tabSelected.borderColor = tokens.primary;
      tabSelected.color = tokens.primary;
      var tabRing = hexToRgba(tokens.primary, 0.18);
      if (tabRing) tabSelected.boxShadow = "0 0 0 2px " + tabRing;
    }
    rules[".Tab--selected"] = tabSelected;

    var error = { fontSize: "14px" };
    if (tokens.danger) error.color = tokens.danger;
    rules[".Error"] = error;

    return { variables: variables, rules: rules };
  }

  /* ==========================================================================
   * 4. Injected stylesheet. No transform on any ancestor of the Element
   * (a transformed ancestor breaks Stripe's fixed-position 3DS overlay), and
   * no position:fixed pay button — under an open mobile keyboard a fixed
   * button sits behind the keyboard.
   * ======================================================================= */

  var CSS = [
    ".dvc-root{position:fixed;inset:0;z-index:2147483000;display:flex;",
    "align-items:center;justify-content:center;padding:24px;",
    "font-family:var(--dvc-font,system-ui,sans-serif);color:var(--dvc-text,CanvasText);",
    "font-size:16px;line-height:1.5}",
    ".dvc-root[hidden]{display:none}",
    ".dvc-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.55)}",
    ".dvc-sheet{position:relative;display:flex;flex-direction:column;width:100%;",
    "max-width:480px;max-height:calc(100dvh - 48px);overflow-y:auto;",
    "background:var(--dvc-sheet-bg,Canvas);border:1px solid var(--dvc-border,currentColor);",
    "border-radius:var(--dvc-radius,0);box-shadow:0 24px 60px -24px rgba(0,0,0,.5)}",
    ".dvc-head{display:flex;align-items:flex-start;gap:12px;padding:20px 20px 8px}",
    ".dvc-title{margin:0;font-size:18px;font-weight:600;flex:1;font-family:inherit;",
    "letter-spacing:normal;text-transform:none;line-height:1.3;color:inherit}",
    /* The two sites style bare form/label/input/h2 selectors globally, so the
     * modal resets what it does not want to inherit. */
    ".dvc-form{margin:0;padding:0;border:0;border-radius:0;background:transparent;",
    "box-shadow:none;display:flex;flex-direction:column;gap:14px}",
    ".dvc-sub{margin:2px 0 0;font-size:14px;color:var(--dvc-text-2,inherit)}",
    ".dvc-close{flex:none;width:34px;height:34px;border-radius:var(--dvc-radius,0);",
    "border:1px solid var(--dvc-border,currentColor);background:transparent;",
    "color:inherit;font-size:18px;line-height:1;cursor:pointer}",
    ".dvc-body{padding:8px 20px 20px;display:flex;flex-direction:column;gap:14px}",
    ".dvc-field{display:block;margin:0;font-family:inherit;font-size:14px;font-weight:500;",
    "letter-spacing:normal;text-transform:none;color:var(--dvc-text-2,inherit)}",
    ".dvc-input{display:block;width:100%;margin-top:6px;padding:13px 14px;font-size:16px;",
    "font-family:inherit;color:var(--dvc-text,CanvasText);",
    "background:var(--dvc-input-bg,Canvas);border:1px solid var(--dvc-border,currentColor);",
    "border-radius:var(--dvc-radius,0);box-sizing:border-box}",
    ".dvc-input:focus{outline:2px solid var(--dvc-primary,currentColor);outline-offset:1px}",
    ".dvc-hint{margin:0;font-size:13px;color:var(--dvc-text-2,inherit)}",
    ".dvc-slot{position:relative;min-height:" + ELEMENT_MIN_HEIGHT + "}",
    ".dvc-mount{min-height:" + ELEMENT_MIN_HEIGHT + "}",
    ".dvc-skeleton{position:absolute;inset:0;background:var(--dvc-sheet-bg,Canvas);",
    "min-height:" + ELEMENT_MIN_HEIGHT + ";border-radius:var(--dvc-radius,0);",
    "border:1px dashed var(--dvc-border,currentColor);display:flex;align-items:center;",
    "justify-content:center;font-size:14px;color:var(--dvc-text-2,inherit);text-align:center;padding:16px}",
    ".dvc-alert{margin:0;padding:12px 14px;font-size:14px;border-radius:var(--dvc-radius,0);",
    "border:1px solid var(--dvc-danger,currentColor);color:var(--dvc-danger,inherit)}",
    ".dvc-alert[hidden],.dvc-skeleton[hidden],.dvc-mount[hidden],.dvc-form[hidden]{display:none}",
    ".dvc-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;",
    "width:100%;padding:15px 18px;font:inherit;font-weight:600;cursor:pointer;",
    "background:var(--dvc-primary,CanvasText);color:var(--dvc-on-primary,Canvas);",
    "border:1px solid var(--dvc-primary,CanvasText);border-radius:var(--dvc-radius,0)}",
    ".dvc-btn[disabled]{opacity:.55;cursor:not-allowed}",
    ".dvc-btn-quiet{background:transparent;color:inherit;border-color:var(--dvc-border,currentColor)}",
    ".dvc-note{margin:0;font-size:13px;text-align:center;color:var(--dvc-text-2,inherit)}",
    ".dvc-rows{margin:0;display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:14px}",
    ".dvc-rows dt{color:var(--dvc-text-2,inherit)}",
    ".dvc-rows dd{margin:0;overflow-wrap:anywhere}",
    ".dvc-spinner{width:15px;height:15px;border:2px solid currentColor;border-right-color:transparent;",
    "border-radius:50%;display:inline-block;animation:dvc-spin .7s linear infinite}",
    "@keyframes dvc-spin{to{rotate:360deg}}",
    "@media (prefers-reduced-motion:reduce){.dvc-spinner{animation:none}}",
    "@media (max-width:640px){.dvc-root{padding:0;align-items:stretch}",
    ".dvc-sheet{max-width:none;height:100dvh;max-height:100dvh;border:0;border-radius:0}}",
    ".dvc-loading{margin:0;font-size:14px;text-align:center;color:var(--dvc-text-2,inherit)}",
    ".dvc-loading[hidden]{display:none}",
    ".dvc-lead-msg{margin:12px 0 0;font-size:14px;color:var(--dvc-text-2,inherit)}",
    ".dvc-lead-msg.dvc-is-error{color:var(--dvc-danger,inherit)}",
    ".dvc-lead-msg[hidden]{display:none}"
  ].join("");

  var stylesInjected = false;

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    var style = document.createElement("style");
    style.setAttribute("data-dvc", "checkout");
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function applyTokens(tokens) {
    var node = document.documentElement;
    var map = {
      "--dvc-primary": tokens.primary,
      "--dvc-on-primary": tokens.onPrimary,
      "--dvc-text": tokens.text,
      "--dvc-text-2": tokens.textSecondary,
      "--dvc-input-bg": tokens.inputBackground,
      "--dvc-sheet-bg": tokens.sheetBackground,
      "--dvc-border": tokens.border,
      "--dvc-danger": tokens.danger,
      "--dvc-radius": tokens.radius,
      "--dvc-font": tokens.font
    };
    Object.keys(map).forEach(function (name) {
      if (map[name]) node.style.setProperty(name, map[name]);
      else node.style.removeProperty(name);
    });
  }

  /* ==========================================================================
   * 5. Modal shell: build once, focus trap, Esc, scroll lock, focus restore.
   * ======================================================================= */

  var modal = null; /* { root, sheet, title, sub, body } */
  var openerButton = null;
  var scrollLock = null;
  var busy = false;

  function buildModal() {
    if (modal) return modal;
    injectStyles();

    var root = el("div", "dvc-root");
    root.hidden = true;

    var backdrop = el("div", "dvc-backdrop");
    backdrop.addEventListener("click", closeModal);

    var sheet = el("div", "dvc-sheet");
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-labelledby", TITLE_ID);
    sheet.setAttribute("tabindex", "-1");

    var head = el("div", "dvc-head");
    var titles = el("div");
    var title = el("h2", "dvc-title", t("dialogLabel"));
    title.id = TITLE_ID;
    var sub = el("p", "dvc-sub", "");
    titles.appendChild(title);
    titles.appendChild(sub);

    var close = el("button", "dvc-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", t("close"));
    close.addEventListener("click", closeModal);

    head.appendChild(titles);
    head.appendChild(close);

    var body = el("div", "dvc-body");

    sheet.appendChild(head);
    sheet.appendChild(body);
    root.appendChild(backdrop);
    root.appendChild(sheet);
    document.body.appendChild(root);

    sheet.addEventListener("keydown", onSheetKeydown);

    modal = { root: root, sheet: sheet, title: title, sub: sub, body: body };
    return modal;
  }

  function onSheetKeydown(event) {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeModal();
      return;
    }
    if (event.key !== "Tab") return;
    var nodes = Array.prototype.filter.call(
      modal.sheet.querySelectorAll(FOCUSABLE),
      function (node) {
        return node.offsetParent !== null || node.tagName === "IFRAME";
      }
    );
    if (nodes.length === 0) return;
    var first = nodes[0];
    var last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function lockScroll() {
    if (scrollLock !== null) return;
    scrollLock = {
      overflow: document.body.style.overflow,
      paddingRight: document.body.style.paddingRight
    };
    var gap = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (gap > 0) document.body.style.paddingRight = gap + "px";
  }

  function unlockScroll() {
    if (scrollLock === null) return;
    document.body.style.overflow = scrollLock.overflow;
    document.body.style.paddingRight = scrollLock.paddingRight;
    scrollLock = null;
  }

  function onDocumentKeydown(event) {
    if (event.key === "Escape") closeModal();
  }

  function openModal(opener) {
    buildModal();
    applyTokens(readTokens());
    openerButton = opener || null;
    modal.root.hidden = false;
    lockScroll();
    document.addEventListener("keydown", onDocumentKeydown);
    window.setTimeout(function () {
      var target =
        modal.body.querySelector(FOCUSABLE) || modal.sheet.querySelector(FOCUSABLE);
      (target || modal.sheet).focus();
    }, 0);
  }

  function closeModal() {
    if (busy) return;
    if (!modal || modal.root.hidden) return;
    modal.root.hidden = true;
    unlockScroll();
    document.removeEventListener("keydown", onDocumentKeydown);
    teardownElements();
    clear(modal.body);
    if (openerButton && document.contains(openerButton)) openerButton.focus();
    openerButton = null;
  }

  function setTitle(main, secondary) {
    modal.title.textContent = main;
    modal.sub.textContent = secondary || "";
  }

  /* ==========================================================================
   * 6. Checkout state.
   * ======================================================================= */

  var stripe = null;
  var elementsInstance = null;
  var paymentElement = null;
  var schemeQuery = null;
  var onSchemeChange = null;

  function teardownElements() {
    if (schemeQuery && onSchemeChange) {
      if (schemeQuery.removeEventListener) {
        schemeQuery.removeEventListener("change", onSchemeChange);
      } else if (schemeQuery.removeListener) {
        schemeQuery.removeListener(onSchemeChange);
      }
    }
    schemeQuery = null;
    onSchemeChange = null;
    if (paymentElement) {
      try {
        paymentElement.destroy();
      } catch (err) {
        /* already detached */
      }
    }
    paymentElement = null;
    elementsInstance = null;
  }

  /* ==========================================================================
   * 7. Stage 1 — email. The api needs the buyer's address to create the
   * Customer and set receipt_email, so the PaymentIntent cannot be created
   * before it is known: the modal opens instantly on this step (never on a
   * blank wait) and the network call starts when it is submitted.
   * ======================================================================= */

  function renderEmailStage(planId) {
    var body = modal.body;
    clear(body);
    setTitle(t("dialogLabel"), "");

    var form = el("form", "dvc-form");
    form.setAttribute("novalidate", "novalidate");

    var label = el("label", "dvc-field", t("emailTitle"));
    var input = el("input", "dvc-input");
    input.type = "email";
    input.name = "email";
    input.autocomplete = "email";
    input.inputMode = "email";
    input.required = true;
    input.placeholder = t("emailPlaceholder");
    label.appendChild(input);

    var hint = el("p", "dvc-hint", t("emailHint"));

    var fieldError = el("p", "dvc-alert");
    fieldError.setAttribute("aria-live", "polite");
    fieldError.hidden = true;

    var submit = el("button", "dvc-btn", t("continue"));
    submit.type = "submit";

    var loading = el("p", "dvc-loading", t("preparing"));
    loading.hidden = true;

    form.appendChild(label);
    form.appendChild(hint);
    form.appendChild(fieldError);
    form.appendChild(submit);

    body.appendChild(form);
    body.appendChild(loading);

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var value = input.value.trim();
      if (!looksLikeEmail(value)) {
        fieldError.hidden = false;
        fieldError.textContent = t("emailInvalid");
        input.focus();
        return;
      }
      fieldError.hidden = true;
      submit.disabled = true;
      submit.textContent = t("preparing");
      loading.hidden = false;
      startCheckout(planId, value, function (message) {
        submit.disabled = false;
        submit.textContent = t("continue");
        loading.hidden = true;
        fieldError.hidden = false;
        fieldError.textContent = message;
      });
    });
  }

  /* ==========================================================================
   * 8. POST /api/checkout, with every response field guarded before use.
   * ======================================================================= */

  function postJson(url, payload) {
    var options = {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      credentials: "omit"
    };
    if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
      options.signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    }
    return fetch(url, options).then(function (response) {
      /* nginx's own limit_req answers with an HTML error page, not JSON, so a
       * body is only parsed opportunistically and never assumed. */
      return response
        .json()
        .catch(function () {
          return null;
        })
        .then(function (body) {
          return { status: response.status, ok: response.ok, body: body };
        });
    });
  }

  function messageForStatus(status, body) {
    var code = isObject(body) ? str(body.error) : null;
    if (status === 429 || code === "rate_limited") return t("errorRateLimited");
    if (status >= 500 || status === 0) return t("errorServer");
    if (status >= 400) return t("errorServer");
    return t("errorUnexpected");
  }

  function startCheckout(planId, email, onFailure) {
    if (typeof window.Stripe !== "function") {
      onFailure(t("errorStripeMissing"));
      return;
    }
    postJson(CHECKOUT_URL, { plan: planId, locale: locale(), email: email })
      .then(function (result) {
        if (!result.ok || !isObject(result.body)) {
          onFailure(messageForStatus(result.status, result.body));
          return;
        }
        var data = result.body;
        var clientSecret = str(data.clientSecret);
        var publishableKey = str(data.publishableKey);
        if (!clientSecret || !publishableKey) {
          onFailure(t("errorServer"));
          return;
        }
        var session = {
          clientSecret: clientSecret,
          publishableKey: publishableKey,
          amountLabel: str(data.amountLabel),
          planLabel: str(data.planLabel),
          returnUrl: safeReturnUrl(str(data.returnUrl)),
          mode: str(data.mode),
          email: email,
          intentId: clientSecret.split("_secret_")[0]
        };
        sessionWrite({
          publishableKey: session.publishableKey,
          intentId: session.intentId,
          amountLabel: session.amountLabel,
          planLabel: session.planLabel,
          email: session.email
        });
        renderPaymentStage(session);
      })
      .catch(function () {
        /* Thrown fetch = transport failure or timeout, never an HTTP status. */
        onFailure(t("errorNetwork"));
      });
  }

  /* return-url-is-derived-server-side, checked again here: the return url is
   * where the buyer lands carrying payment_intent_client_secret, so a foreign
   * origin in that field would hand the secret to someone else. A response
   * that is not same-origin is replaced by this page, not followed. */
  function safeReturnUrl(value) {
    var here = window.location.origin + window.location.pathname;
    if (!value) return here;
    try {
      var parsed = new URL(value, window.location.href);
      if (parsed.origin !== window.location.origin) return here;
      return parsed.href;
    } catch (err) {
      return here;
    }
  }

  /* ==========================================================================
   * 9. Stage 2 — the Payment Element and the pay button.
   * ======================================================================= */

  function renderPaymentStage(session) {
    var body = modal.body;
    clear(body);
    setTitle(session.planLabel || t("dialogLabel"), session.amountLabel || "");

    var slot = el("div", "dvc-slot");
    var mount = el("div", "dvc-mount");
    var skeleton = el("div", "dvc-skeleton", t("preparing"));
    slot.appendChild(mount);
    slot.appendChild(skeleton);

    /* ONE error region, above the pay button. Network and server errors only:
     * decline copy is rendered and localised inside the Element for ~17 codes,
     * so it is never re-rendered, never rewritten, and the card field is never
     * cleared on a decline. */
    var alert = el("p", "dvc-alert");
    alert.setAttribute("role", "alert");
    alert.setAttribute("aria-live", "polite");
    alert.hidden = true;

    var pay = el("button", "dvc-btn", payLabel(session.amountLabel));
    pay.type = "button";
    pay.disabled = true;

    /* test-mode-notice-next-to-the-pay-button, not in a corner. */
    var note = el("p", "dvc-note", t("testNotice"));

    body.appendChild(slot);
    body.appendChild(alert);
    body.appendChild(pay);
    body.appendChild(note);

    var tokens = readTokens();
    applyTokens(tokens);

    try {
      stripe = window.Stripe(session.publishableKey);
    } catch (err) {
      showFatal(t("errorStripeMissing"));
      return;
    }

    elementsInstance = createElements(session, buildAppearance(tokens));
    if (!elementsInstance) {
      showFatal(t("errorUnexpected"));
      return;
    }

    try {
      paymentElement = elementsInstance.create("payment", {
        layout: { type: "tabs" },
        defaultValues: { billingDetails: { email: session.email } }
      });
      paymentElement.mount(mount);
    } catch (err) {
      showFatal(t("errorElementLoad"));
      return;
    }

    /* Neither "ready" nor "loaderror" is guaranteed to arrive: a network that
     * swallows js.stripe.com's sub-requests can leave both silent, and an
     * empty box with a disabled button explains nothing. */
    var watchdog = window.setTimeout(function () {
      failElementLoad();
    }, ELEMENT_READY_TIMEOUT_MS);

    function failElementLoad() {
      window.clearTimeout(watchdog);
      skeleton.hidden = false;
      skeleton.textContent = t("errorElementLoad");
      pay.disabled = true;
      showAlert(alert, t("errorElementLoad"));
      appendContactRoute(body);
    }

    paymentElement.on("ready", function () {
      window.clearTimeout(watchdog);
      skeleton.hidden = true;
      pay.disabled = false;
    });

    /* A blocked js.stripe.com otherwise leaves a permanently empty box. */
    paymentElement.on("loaderror", failElementLoad);

    watchColourScheme();

    pay.addEventListener("click", function () {
      if (pay.disabled) return;
      /* Disabled on click, re-enabled ONLY on error. */
      pay.disabled = true;
      busy = true;
      alert.hidden = true;
      var spinner = el("span", "dvc-spinner");
      clear(pay);
      pay.appendChild(spinner);
      pay.appendChild(document.createTextNode(" " + t("paying")));

      confirmPayment(session)
        .then(function (outcome) {
          busy = false;
          if (outcome.receipt) {
            renderReceipt(outcome.receipt);
            return;
          }
          if (outcome.message) showAlert(alert, outcome.message);
          pay.disabled = false;
          clear(pay);
          pay.textContent = payLabel(session.amountLabel);
        })
        .catch(function () {
          busy = false;
          showAlert(alert, t("errorUnexpected"));
          pay.disabled = false;
          clear(pay);
          pay.textContent = payLabel(session.amountLabel);
        });
    });
  }

  function createElements(session, appearance) {
    var base = {
      clientSecret: session.clientSecret,
      locale: locale(),
      loader: "auto"
    };
    var attempts = [
      { appearance: appearance },
      { appearance: { variables: appearance.variables } },
      {}
    ];
    for (var i = 0; i < attempts.length; i++) {
      var options = { clientSecret: base.clientSecret, locale: base.locale, loader: base.loader };
      if (attempts[i].appearance) options.appearance = attempts[i].appearance;
      try {
        return stripe.elements(options);
      } catch (err) {
        /* An appearance value Stripe cannot parse throws here. Falling back
         * costs the styling, never the payment. */
      }
    }
    return null;
  }

  function payLabel(amountLabel) {
    if (!amountLabel) return t("payPlain");
    return t("pay").split("{amount}").join(amountLabel);
  }

  function showAlert(node, message) {
    node.textContent = message;
    node.hidden = false;
  }

  function showFatal(message) {
    var body = modal.body;
    clear(body);
    var alert = el("p", "dvc-alert", message);
    alert.setAttribute("role", "alert");
    alert.setAttribute("aria-live", "polite");
    body.appendChild(alert);
    appendContactRoute(body);
    var close = el("button", "dvc-btn dvc-btn-quiet", t("close"));
    close.type = "button";
    close.addEventListener("click", closeModal);
    body.appendChild(close);
  }

  /* The contact route offered when the card form cannot load: the page's own
   * lead form, which is the only address-free way to reach the seller here. */
  function appendContactRoute(body) {
    if (body.querySelector(".dvc-contact")) return;
    var leadForm = document.querySelector("form[data-lead]");
    var hint = el("p", "dvc-hint dvc-contact", t("contactHint"));
    body.appendChild(hint);
    if (!leadForm) return;
    var go = el("button", "dvc-btn dvc-btn-quiet", t("contactLink"));
    go.type = "button";
    go.addEventListener("click", function () {
      closeModal();
      leadForm.scrollIntoView({ behavior: "smooth", block: "center" });
      var firstField = leadForm.querySelector("input,select,textarea");
      if (firstField) firstField.focus({ preventScroll: true });
    });
    body.appendChild(go);
  }

  function watchColourScheme() {
    if (!window.matchMedia) return;
    schemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
    onSchemeChange = function () {
      var tokens = readTokens();
      applyTokens(tokens);
      if (!elementsInstance) return;
      try {
        elementsInstance.update({ appearance: buildAppearance(tokens) });
      } catch (err) {
        /* Keeping the previous appearance is preferable to breaking the form. */
      }
    };
    if (schemeQuery.addEventListener) {
      schemeQuery.addEventListener("change", onSchemeChange);
    } else if (schemeQuery.addListener) {
      schemeQuery.addListener(onSchemeChange);
    }
  }

  /* ==========================================================================
   * 10. Confirmation. `elements` carries the client secret, so it is passed
   * alone: confirmPayment documents clientSecret as required only when no
   * elements instance is given. Reported.
   * ======================================================================= */

  function confirmPayment(session) {
    return stripe
      .confirmPayment({
        elements: elementsInstance,
        confirmParams: { return_url: session.returnUrl },
        redirect: "if_required"
      })
      .then(function (result) {
        if (isObject(result) && isObject(result.error)) {
          var error = result.error;
          var type = str(error.type);
          if (type === "card_error" || type === "validation_error") {
            /* The Element has already rendered and localised this. Our region
             * stays untouched and the card field keeps its contents. */
            return { receipt: null, message: null };
          }
          return { receipt: null, message: t("errorServer") };
        }
        if (isObject(result) && isObject(result.paymentIntent)) {
          return { receipt: receiptFromIntent(result.paymentIntent, session), message: null };
        }
        return { receipt: null, message: t("errorUnexpected") };
      })
      .catch(function () {
        return { receipt: null, message: t("errorNetwork") };
      });
  }

  function receiptFromIntent(intent, session) {
    var status = str(intent.status) || "";
    return {
      status: status,
      id: str(intent.id),
      planLabel: (session && session.planLabel) || str(intent.description),
      amountLabel: session ? session.amountLabel : null,
      email: (session && session.email) || str(intent.receipt_email)
    };
  }

  /* ==========================================================================
   * 11. Receipt panel — shared by the in-place success branch and the
   * redirect landing (return-landing-is-the-same-page).
   * ======================================================================= */

  function renderReceipt(receipt) {
    var body = modal.body;
    clear(body);

    var succeeded = receipt.status === "succeeded";
    var processing = receipt.status === "processing";
    var title = succeeded
      ? t("receiptTitle")
      : processing
        ? t("receiptProcessingTitle")
        : t("receiptUnknownTitle");
    setTitle(title, "");

    if (!succeeded) {
      body.appendChild(
        el("p", "dvc-hint", processing ? t("receiptProcessingBody") : t("receiptUnknownBody"))
      );
    }

    var rows = el("dl", "dvc-rows");
    function addRow(label, value) {
      if (!value) return;
      rows.appendChild(el("dt", null, label));
      rows.appendChild(el("dd", null, value));
    }
    addRow(t("labelPlan"), receipt.planLabel);
    addRow(t("labelAmount"), receipt.amountLabel);
    addRow(t("labelReference"), receipt.id);
    addRow(t("labelEmail"), receipt.email);
    if (rows.childNodes.length > 0) body.appendChild(rows);

    if (receipt.email) body.appendChild(el("p", "dvc-hint", t("emailWrong")));
    body.appendChild(el("p", "dvc-note", t("receiptTestNote")));

    var done = el("button", "dvc-btn", t("done"));
    done.type = "button";
    done.addEventListener("click", closeModal);
    body.appendChild(done);
    done.focus();
  }

  /* On load, a payment_intent_client_secret in the query string means the
   * buyer came back from a redirect (a bank's 3DS page). Shipping only the
   * in-place success branch is the classic half-integration. */
  function handleReturnLanding() {
    var params = new URLSearchParams(window.location.search);
    var clientSecret = params.get("payment_intent_client_secret");
    if (!clientSecret) return;

    /* The secret is removed from the address bar before anything else, so it
     * does not survive in history, bookmarks or a referrer. Any other query
     * parameter the buyer arrived with (campaign tags, for instance) is kept. */
    params.delete("payment_intent_client_secret");
    params.delete("payment_intent");
    params.delete("redirect_status");
    var rest = params.toString();
    var cleanUrl =
      window.location.pathname + (rest ? "?" + rest : "") + window.location.hash;
    try {
      window.history.replaceState(null, "", cleanUrl);
    } catch (err) {
      /* Not fatal: the panel still renders. */
    }

    var cached = sessionRead();
    var intentId = clientSecret.split("_secret_")[0];
    var known =
      cached && str(cached.intentId) === intentId
        ? cached
        : { publishableKey: cached ? str(cached.publishableKey) : null };
    var publishableKey = str(known.publishableKey);

    buildModal();
    openModal(null);

    if (!publishableKey || typeof window.Stripe !== "function") {
      /* No key on this page load: the payment is not readable from here, and
       * saying so is better than inventing a status. */
      renderReceipt({
        status: "unknown",
        id: null,
        planLabel: null,
        amountLabel: null,
        email: null
      });
      return;
    }

    var client;
    try {
      client = window.Stripe(publishableKey);
    } catch (err) {
      renderReceipt({ status: "unknown", id: null, planLabel: null, amountLabel: null, email: null });
      return;
    }

    modal.body.appendChild(el("p", "dvc-loading", t("preparing")));
    client
      .retrievePaymentIntent(clientSecret)
      .then(function (result) {
        if (!isObject(result) || !isObject(result.paymentIntent)) {
          renderReceipt({ status: "unknown", id: null, planLabel: null, amountLabel: null, email: null });
          return;
        }
        renderReceipt(
          receiptFromIntent(result.paymentIntent, {
            planLabel: str(known.planLabel),
            amountLabel: str(known.amountLabel),
            email: str(known.email)
          })
        );
      })
      .catch(function () {
        renderReceipt({ status: "unknown", id: null, planLabel: null, amountLabel: null, email: null });
      });
  }

  /* ==========================================================================
   * 12. BINDING 2 — lead forms. Success is shown only after a 200; the page
   * used to relabel the button on submit and store nothing.
   * ======================================================================= */

  function serializeLead(form) {
    var payload = { locale: locale() };
    var fields = form.querySelectorAll("input[name],select[name],textarea[name]");
    Array.prototype.forEach.call(fields, function (field) {
      var name = field.getAttribute("name");
      if (!name) return;
      if (field.type === "checkbox" || field.type === "radio") {
        if (!field.checked) return;
      }
      payload[name] = typeof field.value === "string" ? field.value : "";
    });
    return payload;
  }

  function bindLeadForm(form) {
    if (form.getAttribute("data-dvc-bound") === "true") return;
    form.setAttribute("data-dvc-bound", "true");

    var message = el("p", "dvc-lead-msg");
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");
    message.hidden = true;
    form.appendChild(message);

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var button = form.querySelector('button[type="submit"], button:not([type])');
      var originalLabel = button ? button.textContent : null;
      if (button) {
        button.disabled = true;
        button.textContent = t("leadSending");
      }
      message.hidden = true;

      postJson(LEAD_URL, serializeLead(form))
        .then(function (result) {
          var accepted = result.ok && isObject(result.body) && result.body.ok === true;
          if (accepted) {
            if (button) {
              button.textContent = t("leadSuccess");
              button.disabled = true;
            }
            message.textContent = t("leadSuccessBody");
            message.classList.remove("dvc-is-error");
            message.hidden = false;
            return;
          }
          if (button) {
            button.disabled = false;
            if (originalLabel !== null) button.textContent = originalLabel;
          }
          message.textContent =
            result.status === 429 ? t("leadRateLimited") : t("leadError");
          message.classList.add("dvc-is-error");
          message.hidden = false;
        })
        .catch(function () {
          if (button) {
            button.disabled = false;
            if (originalLabel !== null) button.textContent = originalLabel;
          }
          message.textContent = t("errorNetwork");
          message.classList.add("dvc-is-error");
          message.hidden = false;
        });
    });
  }

  /* ==========================================================================
   * 13. Bootstrap — BINDING 1, BINDING 2, and the return landing.
   * ======================================================================= */

  function bindPlanButtons() {
    var buttons = document.querySelectorAll("[data-plan]");
    Array.prototype.forEach.call(buttons, function (button) {
      if (button.getAttribute("data-dvc-bound") === "true") return;
      button.setAttribute("data-dvc-bound", "true");
      button.addEventListener("click", function (event) {
        var planId = button.getAttribute("data-plan");
        if (!planId) return;
        event.preventDefault();
        if (modal && !modal.root.hidden) return;
        buildModal();
        openModal(button);
        renderEmailStage(planId);
      });
    });
  }

  function start() {
    if (!document.body) return;
    injectStyles();
    applyTokens(readTokens());
    bindPlanButtons();
    Array.prototype.forEach.call(
      document.querySelectorAll("form[data-lead]"),
      bindLeadForm
    );
    handleReturnLanding();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
