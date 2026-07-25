/* =========================================================================
   MyHaut — storefront behaviour
   - one shared "selected variant" state across hero / sticky bar / bundles
   - AJAX add to cart + cart drawer (rendered server-side via the Section
     Rendering API, so prices/translations always come from Liquid)
   - sticky bar reveal, mobile nav, smooth scrolling
   ========================================================================= */

(function () {
  'use strict';

  var CONFIG = window.MyHautConfig || {};
  var strings = CONFIG.strings || {};

  /* ---------------------------------------------------------------- utils */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function formatString(template, replacements) {
    return String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, function (match, key) {
      return Object.prototype.hasOwnProperty.call(replacements, key) ? replacements[key] : match;
    });
  }

  /* --------------------------------------------------------- product data */

  var product = null;
  var variantsById = {};
  var selectedId = null;

  function readProductData() {
    var node = $('[data-mh-product-data]');
    if (!node) return null;
    try {
      return JSON.parse(node.textContent);
    } catch (error) {
      return null;
    }
  }

  function initProduct() {
    product = readProductData();
    if (!product || !product.variants || !product.variants.length) return;

    product.variants.forEach(function (variant) { variantsById[variant.id] = variant; });

    var fromUrl = new URLSearchParams(window.location.search).get('variant');
    var preferred = [fromUrl, product.selected_id, product.default_id];
    var chosen = null;

    for (var i = 0; i < preferred.length; i++) {
      var id = preferred[i] && String(preferred[i]);
      if (id && variantsById[id]) { chosen = id; break; }
    }
    if (!chosen) {
      var available = product.variants.filter(function (v) { return v.available; })[0];
      chosen = String((available || product.variants[0]).id);
    }
    selectVariant(chosen, { silent: true, updateUrl: false });
  }

  function selectVariant(id, options) {
    options = options || {};
    id = String(id);
    if (!variantsById[id]) return;
    selectedId = id;
    render();

    if (options.updateUrl !== false && window.history.replaceState) {
      var url = new URL(window.location.href);
      url.searchParams.set('variant', id);
      window.history.replaceState({}, '', url.toString());
    }
    if (!options.silent) {
      document.dispatchEvent(new CustomEvent('myhaut:variant:change', { detail: variantsById[id] }));
    }
  }

  function render() {
    var variant = variantsById[selectedId];
    if (!variant) return;

    $$('[data-mh-form-variant]').forEach(function (input) { input.value = variant.id; });

    $$('[data-mh-price]').forEach(function (el) { el.textContent = variant.price; });

    $$('[data-mh-compare]').forEach(function (el) {
      el.textContent = variant.compare_at || '';
      el.hidden = !variant.compare_at;
    });

    $$('[data-mh-discount]').forEach(function (el) {
      if (variant.discount_percent) {
        el.textContent = formatString(strings.save_percent_short || '−{{ percent }} %', { percent: variant.discount_percent });
        el.hidden = false;
      } else {
        el.textContent = '';
        el.hidden = true;
      }
    });

    $$('[data-mh-save-note]').forEach(function (el) {
      if (variant.discount_percent) {
        el.textContent = formatString(strings.save_percent || 'spare {{ percent }} %', { percent: variant.discount_percent });
        el.hidden = false;
      } else {
        el.hidden = true;
      }
    });

    $$('[data-mh-unit-price]').forEach(function (el) {
      if (variant.unit_price) {
        el.textContent = formatString(strings.per_bottle || '{{ price }}', { price: variant.unit_price });
        el.hidden = false;
      } else {
        el.hidden = true;
      }
    });

    $$('[data-mh-variant-title]').forEach(function (el) { el.textContent = variant.title; });

    $$('[data-mh-select]').forEach(function (el) {
      var isActive = String(el.getAttribute('data-mh-select')) === String(selectedId);
      el.classList.toggle('is-active', isActive);
      if (el.hasAttribute('aria-pressed')) el.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      var card = el.closest('.mh-bundle');
      if (card) card.classList.toggle('is-selected', isActive);
    });

    $$('[data-mh-add]').forEach(function (button) {
      var label = button.querySelector('[data-mh-add-label]') || button;
      if (variant.available) {
        button.removeAttribute('disabled');
        label.textContent = button.getAttribute('data-mh-add-label-text') || label.textContent;
      } else {
        button.setAttribute('disabled', 'disabled');
        label.textContent = strings.sold_out || 'Sold out';
      }
    });
  }

  /* ------------------------------------------------------------ cart glue */

  var drawer = null;
  var lastFocused = null;

  function drawerEl() {
    if (!drawer) drawer = $('[data-mh-drawer]');
    return drawer;
  }

  function openDrawer() {
    var el = drawerEl();
    if (!el) return;
    lastFocused = document.activeElement;
    el.classList.add('is-open');
    el.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    var close = el.querySelector('[data-mh-drawer-close]');
    if (close) close.focus();
  }

  function closeDrawer() {
    var el = drawerEl();
    if (!el) return;
    el.classList.remove('is-open');
    el.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  function updateCartCount(count) {
    $$('[data-mh-cart-count]').forEach(function (el) {
      el.textContent = count;
      el.hidden = false;
    });
  }

  function refreshDrawer() {
    return fetch(CONFIG.routes.root + '?section_id=mh-cart-drawer', { credentials: 'same-origin' })
      .then(function (response) { return response.text(); })
      .then(function (html) {
        var host = $('#shopify-section-mh-cart-drawer');
        if (!host) return;
        var parsed = new DOMParser().parseFromString(html, 'text/html');
        var fresh = parsed.querySelector('#shopify-section-mh-cart-drawer');
        if (!fresh) return;
        var wasOpen = host.querySelector('.mh-drawer.is-open');
        host.innerHTML = fresh.innerHTML;
        drawer = null;
        if (wasOpen) {
          var el = drawerEl();
          if (el) {
            el.classList.add('is-open');
            el.setAttribute('aria-hidden', 'false');
          }
        }
        var countNode = parsed.querySelector('[data-mh-drawer-count]');
        if (countNode) updateCartCount(countNode.getAttribute('data-mh-drawer-count'));
      });
  }

  function addToCart(button) {
    var variant = variantsById[selectedId];
    if (!variant || !variant.available) return;

    var label = button.querySelector('[data-mh-add-label]') || button;
    var originalHtml = label.innerHTML;
    button.setAttribute('disabled', 'disabled');
    label.textContent = strings.adding || label.textContent;

    fetch(CONFIG.routes.cart_add_url + '.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ items: [{ id: Number(variant.id), quantity: 1 }] })
    })
      .then(function (response) {
        if (!response.ok) throw new Error('add-to-cart failed');
        return response.json();
      })
      .then(function () { return refreshDrawer(); })
      .then(function () {
        label.textContent = strings.added || label.textContent;
        if (CONFIG.cartDrawer !== false) openDrawer();
        window.setTimeout(function () { label.innerHTML = originalHtml; }, 1600);
      })
      .catch(function () {
        label.innerHTML = originalHtml;
        window.alert(strings.cart_error || 'Something went wrong.');
      })
      .finally(function () { button.removeAttribute('disabled'); render(); });
  }

  function changeLine(line, quantity) {
    return fetch(CONFIG.routes.cart_change_url + '.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ line: Number(line), quantity: Number(quantity) })
    })
      .then(function (response) { return response.json(); })
      .then(function (cart) {
        updateCartCount(cart.item_count);
        return refreshDrawer();
      });
  }

  /* ------------------------------------------------------- sticky ATC bar */

  function initStickyBar() {
    var bar = $('[data-mh-sticky]');
    if (!bar) return;

    document.body.classList.add('mh-has-sticky-atc');

    var triggerSelector = bar.getAttribute('data-mh-sticky-after');
    var trigger = triggerSelector ? $(triggerSelector) : null;

    function update() {
      var threshold = trigger
        ? trigger.getBoundingClientRect().bottom
        : window.innerHeight * 0.6 - window.scrollY;
      bar.classList.toggle('is-visible', threshold <= 0);
    }

    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
  }

  /* -------------------------------------------------------------- events */

  function initEvents() {
    document.addEventListener('click', function (event) {
      var selectTrigger = event.target.closest('[data-mh-select]');
      if (selectTrigger) {
        var action = selectTrigger.getAttribute('data-mh-select-action');
        selectVariant(selectTrigger.getAttribute('data-mh-select'));
        if (action === 'add') {
          addToCart(selectTrigger);
        } else if (action === 'scroll') {
          var target = $(selectTrigger.getAttribute('data-mh-select-scroll') || '#mh-buy');
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        if (selectTrigger.tagName === 'BUTTON') event.preventDefault();
        return;
      }

      var addTrigger = event.target.closest('[data-mh-add]');
      if (addTrigger) {
        event.preventDefault();
        addToCart(addTrigger);
        return;
      }

      var openTrigger = event.target.closest('[data-mh-cart-open]');
      if (openTrigger) {
        event.preventDefault();
        openDrawer();
        return;
      }

      if (event.target.closest('[data-mh-drawer-close]') || event.target.closest('[data-mh-drawer-overlay]')) {
        event.preventDefault();
        closeDrawer();
        return;
      }

      var lineTrigger = event.target.closest('[data-mh-line-change]');
      if (lineTrigger) {
        event.preventDefault();
        changeLine(lineTrigger.getAttribute('data-mh-line'), lineTrigger.getAttribute('data-mh-line-change'));
        return;
      }

      var scrollTrigger = event.target.closest('[data-mh-scroll]');
      if (scrollTrigger) {
        var scrollTarget = $(scrollTrigger.getAttribute('data-mh-scroll'));
        if (scrollTarget) {
          event.preventDefault();
          scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        return;
      }

      var navTrigger = event.target.closest('[data-mh-nav-toggle]');
      if (navTrigger) {
        event.preventDefault();
        var nav = $('[data-mh-nav]');
        if (nav) {
          var isOpen = nav.classList.toggle('is-open');
          navTrigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        }
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeDrawer();
    });

    // no-JS friendly product forms still work; with JS we intercept them
    $$('[data-mh-form]').forEach(function (form) {
      form.addEventListener('submit', function (event) {
        var submitButton = form.querySelector('[data-mh-add]');
        if (!submitButton) return;
        event.preventDefault();
        addToCart(submitButton);
      });
    });
  }

  /* ---------------------------------------------------------------- boot */

  function init() {
    initProduct();
    initStickyBar();
    initEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Theme editor: re-init when a section is re-rendered
  document.addEventListener('shopify:section:load', function () {
    variantsById = {};
    drawer = null;
    initProduct();
    initStickyBar();
  });
})();
