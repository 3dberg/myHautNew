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

  // Scroll targets come from theme settings, so they can be a full URL rather
  // than a selector — querySelector throws on those.
  function querySafe(sel) {
    if (!sel) return null;
    try {
      return document.querySelector(sel);
    } catch (error) {
      return null;
    }
  }

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

    $$('[data-mh-base-price]').forEach(function (el) {
      if (variant.base_price) {
        el.textContent = formatString(strings.base_price || '{{ price }}', { price: variant.base_price });
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

    $$('[data-mh-saving]').forEach(function (el) {
      if (variant.saving) {
        el.textContent = formatString(strings.saving || '{{ amount }}', { amount: variant.saving });
        el.hidden = false;
      } else {
        el.hidden = true;
      }
    });

    $$('[data-mh-free-shipping]').forEach(function (el) {
      el.hidden = !variant.free_shipping;
    });

    syncWaitlistTags();

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
        // A label may carry a {price} token (closing CTA): fill it with the
        // selected variant's price instead of printing the token.
        var text = button.getAttribute('data-mh-add-label-text') || label.textContent;
        label.textContent = text.replace('{price}', variant.price);
      } else {
        button.setAttribute('disabled', 'disabled');
        label.textContent = strings.sold_out || 'Sold out';
      }
    });
  }

  /* -------------------------------------------------------------- waitlist */

  /* Where somebody came from is the only thing that makes a test campaign
     readable afterwards, so the UTM parameters ride along with the signup as
     customer tags — no tracking pixel needed to tell the campaigns apart. */
  var campaignTags = (function () {
    var params = new URLSearchParams(window.location.search);
    return ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content']
      .map(function (key) {
        var value = params.get(key);
        return value ? key.replace('utm_', '') + ':' + value : null;
      })
      .filter(Boolean);
  })();

  /* Shopify splits customer tags on commas, so a comma inside one would
     silently turn a single tag into two. */
  function sanitizeTag(value) {
    return String(value || '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function syncWaitlistTags() {
    var variant = variantsById[selectedId];
    $$('[data-mh-waitlist-tags]').forEach(function (input) {
      var tags = (input.getAttribute('data-mh-waitlist-tags-base') || '')
        .split(',')
        .map(sanitizeTag)
        .filter(Boolean);

      if (variant) tags.push('set:' + sanitizeTag(variant.title));
      campaignTags.forEach(function (tag) { tags.push(sanitizeTag(tag)); });

      input.value = tags.join(',');
    });
  }

  function focusWaitlistEmail() {
    var field = $('[data-mh-waitlist-email]');
    if (!field) return;
    // preventScroll so the smooth scroll that just started isn't cut short.
    window.setTimeout(function () {
      try {
        field.focus({ preventScroll: true });
      } catch (error) {
        field.focus();
      }
    }, 400);
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

  /* -------------------------------------------------------- video player */

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var canHover = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  // A clip has to sit in view this long before it starts (or, with autoplay
  // off, before its play control fades in), so people scrolling past are not
  // interrupted. The carousel can override it from the editor.
  var ATTENTION_MS = 1500;
  // Nothing playable after this long means the rendition is too heavy for the
  // connection: step down to the small one and keep waiting.
  var STALL_MS = 6000;

  function videoFrame(video) { return video.closest('[data-mh-video-frame]'); }

  function videoState(video, state) {
    var frame = videoFrame(video);
    if (frame) frame.setAttribute('data-mh-video-state', state);
  }

  function setSound(video, on) {
    video.muted = !on;
    var frame = videoFrame(video);
    var button = frame ? frame.querySelector('[data-mh-video-sound]') : null;
    if (button) {
      var label = on ? (strings.mute || 'Mute') : (strings.unmute || 'Unmute');
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
      button.setAttribute('aria-label', label);
      var text = button.querySelector('[data-mh-video-sound-label]');
      if (text) text.textContent = label;
    }
  }

  function playSafe(video) {
    var promise = video.play();
    if (promise && promise.catch) {
      // Refused (battery saver, unmuted without a gesture, …): show the play
      // control rather than a poster that does nothing.
      promise.catch(function () { if (video.paused) videoState(video, 'ready'); });
    }
  }

  function connectionIsSlow() {
    var connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!connection) return false;
    if (connection.saveData) return true;
    return /(^|-)2g$|^3g$/.test(connection.effectiveType || '');
  }

  function canPlayHls(video) {
    var answer = video.canPlayType ? video.canPlayType('application/vnd.apple.mpegurl') : '';
    return answer === 'probably' || answer === 'maybe';
  }

  // Which rendition to fetch: the HLS stream where the browser plays it
  // natively (Safari — it adapts by itself), otherwise the 720p file, and the
  // 480p file straight away on slow or metered connections or when the
  // section asks for it.
  function pickSource(video, forceSd) {
    var quality = video.getAttribute('data-mh-quality') || 'auto';
    var hls = video.getAttribute('data-mh-src-hls');
    var hd = video.getAttribute('data-mh-src-hd');
    var sd = video.getAttribute('data-mh-src-sd') || hd;
    if (forceSd || quality === 'sd' || (quality !== 'hd' && connectionIsSlow())) return { url: sd, tier: 'sd' };
    // canPlayType only ever says "maybe" for HLS, so a stream that then fails
    // is retried as plain MP4 (see the error handler in setupPlayer).
    if (hls && !video.getAttribute('data-mh-no-hls') && canPlayHls(video)) return { url: hls, tier: 'hls' };
    return { url: hd || sd, tier: 'hd' };
  }

  // Attaches a source once; with forceSd it swaps a heavier one for the 480p
  // file at the same position.
  function attachSource(video, forceSd) {
    var attached = video.getAttribute('src');
    if (attached && !(forceSd && video.getAttribute('data-mh-tier') !== 'sd')) return true;
    var choice = pickSource(video, forceSd);
    if (!choice.url) { videoState(video, 'error'); return false; }
    var position = video.currentTime || 0;
    var player = video._mh;
    if (player) player.swapping = !!attached;
    video.setAttribute('data-mh-tier', choice.tier);
    video.preload = 'auto';
    video.src = choice.url;
    if (position > 0) {
      video.addEventListener('loadedmetadata', function seek() {
        video.removeEventListener('loadedmetadata', seek);
        try { video.currentTime = position; } catch (error) { /* not seekable */ }
      });
    }
    return true;
  }

  // One state machine per clip: loading / ready / playing / paused / error on
  // the frame, a progress bar, and a watchdog that steps the quality down when
  // nothing arrives.
  function setupPlayer(video) {
    if (video._mh) return video._mh;
    var frame = videoFrame(video);
    var player = video._mh = {
      wanted: false,    // the visitor has this clip in front of them
      wantPlay: false,  // and it should be running
      swapping: false,  // a source change of our own is in progress
      timer: null,
      stall: null,
      buffered: 0,
      frame: frame,
      bar: frame ? frame.querySelector('[data-mh-video-progress]') : null
    };

    function bufferedEnd() {
      try { return video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0; } catch (error) { return 0; }
    }

    function clearStall() { if (player.stall) { clearTimeout(player.stall); player.stall = null; } }
    function armStall() {
      clearStall();
      player.stall = setTimeout(function () {
        player.stall = null;
        if (video.readyState >= 3) return;
        // Bytes are still arriving: a heavier file that is nearly there must
        // not be thrown away for a restart on the small one.
        var now = bufferedEnd();
        var progressing = now > player.buffered + 0.25;
        player.buffered = now;
        if (progressing) { armStall(); return; }
        if (video.getAttribute('data-mh-tier') !== 'sd') {
          attachSource(video, true);
          if (player.wantPlay) playSafe(video);
        } else if (frame) {
          frame.setAttribute('data-mh-slow', 'true');
        }
        armStall();
      }, STALL_MS);
    }
    function arrived() {
      clearStall();
      if (frame) frame.removeAttribute('data-mh-slow');
    }

    video.addEventListener('loadstart', function () { player.buffered = 0; videoState(video, 'loading'); armStall(); });
    video.addEventListener('waiting', function () { videoState(video, 'loading'); armStall(); });
    video.addEventListener('stalled', armStall);
    video.addEventListener('canplay', function () { arrived(); if (video.paused && !player.wantPlay) videoState(video, 'ready'); });
    video.addEventListener('playing', function () { arrived(); player.swapping = false; videoState(video, 'playing'); });
    video.addEventListener('pause', function () {
      if (player.swapping) return;
      if (video.getAttribute('src')) videoState(video, player.wanted ? 'paused' : 'ready');
    });
    video.addEventListener('error', function () {
      clearStall();
      if (video.getAttribute('data-mh-tier') === 'hls') {
        video.setAttribute('data-mh-no-hls', 'true');
        player.swapping = true;
        video.removeAttribute('src');
        video.removeAttribute('data-mh-tier');
        if (attachSource(video) && player.wantPlay) playSafe(video);
        return;
      }
      videoState(video, 'error');
    });
    video.addEventListener('timeupdate', function () {
      if (player.bar && video.duration) player.bar.style.width = (video.currentTime / video.duration * 100).toFixed(1) + '%';
    });
    return player;
  }

  function soloVideo(video) {
    $$('[data-mh-video]').forEach(function (other) {
      if (other !== video && other._mh && (other._mh.wantPlay || !other.paused)) sleepVideo(other);
    });
  }

  function startVideo(video, withSound) {
    var player = setupPlayer(video);
    soloVideo(video);
    player.wanted = true;
    player.wantPlay = true;
    if (player.frame) player.frame.classList.add('is-attentive');
    attachSource(video);
    if (withSound) setSound(video, true);
    if (video.readyState < 3) videoState(video, 'loading');
    playSafe(video);
    if (typeof CustomEvent === 'function') video.dispatchEvent(new CustomEvent('mh:video:start', { bubbles: true }));
  }

  function pauseVideo(video) {
    var player = setupPlayer(video);
    player.wantPlay = false;
    video.pause();
  }

  // The visitor has this clip in front of them: fetch it, and after the
  // attention delay either start it (autoplay) or reveal the play control.
  function wakeVideo(video, options) {
    var player = setupPlayer(video);
    var settings = options || {};
    player.wanted = true;
    attachSource(video);
    if (player.timer) clearTimeout(player.timer);
    var delay = typeof settings.attention === 'number' ? settings.attention : ATTENTION_MS;
    player.timer = setTimeout(function () {
      player.timer = null;
      if (!player.wanted) return;
      if (player.frame) player.frame.classList.add('is-attentive');
      if (settings.autoplay) startVideo(video, false);
    }, delay);
  }

  function sleepVideo(video) {
    var player = video._mh;
    if (!player) return;
    player.wanted = false;
    player.wantPlay = false;
    if (player.timer) { clearTimeout(player.timer); player.timer = null; }
    if (player.frame) player.frame.classList.remove('is-attentive');
    if (!video.paused) video.pause();
    if (!video.muted) setSound(video, false);
  }

  function initVideoCarousels(root) {
    $$('[data-mh-carousel]', root).forEach(function (carousel) {
      if (carousel.getAttribute('data-mh-carousel-ready')) return;
      carousel.setAttribute('data-mh-carousel-ready', 'true');

      var track = carousel.querySelector('[data-mh-carousel-track]');
      var section = carousel.closest('.shopify-section') || carousel.parentNode;
      var prev = section.querySelector('[data-mh-carousel-prev]');
      var next = section.querySelector('[data-mh-carousel-next]');
      var dots = $$('[data-mh-carousel-dot]', section);
      var slides = $$('[data-mh-video-slide]', track);
      var autoplay = carousel.getAttribute('data-mh-autoplay') !== 'false' && !reduceMotion;
      var attention = parseInt(carousel.getAttribute('data-mh-attention'), 10);
      if (isNaN(attention)) attention = ATTENTION_MS;
      var quality = carousel.getAttribute('data-mh-quality') || 'auto';
      var active = null;
      var inView = false;

      function slideVideo(slide) { return slide ? slide.querySelector('[data-mh-video]') : null; }

      slides.forEach(function (slide) {
        var video = slideVideo(slide);
        if (!video) return;
        video.setAttribute('data-mh-quality', quality);
        setupPlayer(video);
      });

      function slideWidth() {
        var slide = slides[0];
        if (!slide) return track.clientWidth;
        var gap = parseFloat(window.getComputedStyle(track).columnGap || window.getComputedStyle(track).gap) || 0;
        return slide.getBoundingClientRect().width + gap;
      }

      function updateNav() {
        if (!prev || !next) return;
        var max = track.scrollWidth - track.clientWidth - 1;
        prev.disabled = track.scrollLeft <= 0;
        next.disabled = track.scrollLeft >= max;
      }

      function updateDots() {
        var index = slides.indexOf(active);
        dots.forEach(function (dot, i) {
          if (i === index) dot.setAttribute('aria-current', 'true');
          else dot.removeAttribute('aria-current');
        });
      }

      // "The" clip: the one nearest the middle of a swipeable track, the first
      // one when everything fits on screen (desktop).
      function nearestSlide() {
        if (!slides.length) return null;
        if (track.scrollWidth <= track.clientWidth + 1) return active || slides[0];
        var rect = track.getBoundingClientRect();
        var middle = rect.left + rect.width / 2;
        var best = slides[0];
        var bestDistance = Infinity;
        slides.forEach(function (slide) {
          var box = slide.getBoundingClientRect();
          var distance = Math.abs(box.left + box.width / 2 - middle);
          if (distance < bestDistance) { bestDistance = distance; best = slide; }
        });
        return best;
      }

      function wakeActive() {
        var video = slideVideo(active);
        if (video) wakeVideo(video, { autoplay: autoplay, attention: attention });
        // Warm the following clip, so a swipe lands on something that starts
        // at once.
        var following = slideVideo(slides[slides.indexOf(active) + 1]);
        if (following && !following.getAttribute('src')) attachSource(following);
      }

      function setActive(slide) {
        if (slide === active) return;
        slides.forEach(function (other) {
          var video = slideVideo(other);
          if (video && other !== slide) sleepVideo(video);
        });
        active = slide;
        updateDots();
        if (active && inView) wakeActive();
      }

      if (prev) prev.addEventListener('click', function () { track.scrollBy({ left: -slideWidth(), behavior: reduceMotion ? 'auto' : 'smooth' }); });
      if (next) next.addEventListener('click', function () { track.scrollBy({ left: slideWidth(), behavior: reduceMotion ? 'auto' : 'smooth' }); });
      dots.forEach(function (dot, i) {
        dot.addEventListener('click', function () {
          if (slides[i]) slides[i].scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest', inline: 'center' });
        });
      });
      if (canHover) {
        slides.forEach(function (slide) {
          slide.addEventListener('mouseenter', function () {
            var current = slideVideo(active);
            if (inView && !(current && !current.paused && !current.muted)) setActive(slide);
          });
        });
      }
      // A tap on any slide makes it the active one (desktop shows several).
      track.addEventListener('mh:video:start', function (event) {
        var slide = event.target.closest ? event.target.closest('[data-mh-video-slide]') : null;
        if (slide && slide !== active) {
          if (slideVideo(active)) sleepVideo(slideVideo(active));
          active = slide;
          updateDots();
        }
      });

      var ticking = false;
      track.addEventListener('scroll', function () {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(function () {
          updateNav();
          setActive(nearestSlide());
          ticking = false;
        });
      }, { passive: true });
      window.addEventListener('resize', updateNav);
      updateNav();

      if ('IntersectionObserver' in window) {
        // Approaching: fetch the first clip before the visitor gets here.
        var warm = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            var first = slideVideo(nearestSlide());
            if (first) attachSource(first);
            warm.disconnect();
          });
        }, { rootMargin: '400px 0px' });
        warm.observe(carousel);

        // On screen: run the active clip. Off screen: everything sleeps, so no
        // sound ever keeps running out of view.
        var observer = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            inView = entry.isIntersecting;
            if (inView) {
              var slide = nearestSlide();
              if (slide === active) wakeActive();
              else setActive(slide);
            } else {
              slides.forEach(function (slide) {
                var video = slideVideo(slide);
                if (video) sleepVideo(video);
              });
            }
          });
        }, { threshold: 0.4 });
        observer.observe(carousel);
        carousel._mhObserver = observer;
        carousel._mhWarm = warm;
      } else {
        inView = true;
        setActive(nearestSlide());
      }
    });
  }

  // Clips outside a carousel (tester-quote cards): same in-view behaviour.
  function initInlineVideos(root) {
    if (!('IntersectionObserver' in window)) return;
    var solo = $$('[data-mh-video]', root).filter(function (video) {
      return !video.closest('[data-mh-carousel]') && !video.getAttribute('data-mh-video-ready');
    });
    if (!solo.length) return;
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) wakeVideo(entry.target, { autoplay: !reduceMotion });
        else sleepVideo(entry.target);
      });
    }, { threshold: 0.6 });
    solo.forEach(function (video) {
      video.setAttribute('data-mh-video-ready', 'true');
      setupPlayer(video);
      observer.observe(video);
    });
  }

  function toggleVideoSound(video) {
    if (video.muted) startVideo(video, true);
    else setSound(video, false);
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) return;
    $$('[data-mh-video]').forEach(function (video) { if (!video.paused) video.pause(); });
  });

  /* ---------------------------------------------------------- gallery */

  function showGalleryMedia(gallery, mediaId) {
    if (!gallery || !mediaId) return;
    var found = false;
    $$('[data-mh-gallery-slide]', gallery).forEach(function (slide) {
      var active = String(slide.getAttribute('data-mh-gallery-slide')) === String(mediaId);
      slide.classList.toggle('is-active', active);
      if (active) found = true;
      var video = slide.querySelector('video');
      if (video && !active) video.pause();
    });
    if (!found) return;
    $$('[data-mh-gallery-thumb]', gallery).forEach(function (thumb) {
      var active = String(thumb.getAttribute('data-mh-gallery-thumb')) === String(mediaId);
      thumb.classList.toggle('is-active', active);
      thumb.setAttribute('aria-pressed', active ? 'true' : 'false');
      if (active && thumb.scrollIntoView) {
        try { thumb.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' }); } catch (error) { /* older browsers */ }
      }
    });
  }

  // A set has its own photo: choosing it shows that photo.
  document.addEventListener('myhaut:variant:change', function (event) {
    var variant = event.detail;
    if (!variant || !variant.media_id) return;
    $$('[data-mh-gallery]').forEach(function (gallery) { showGalleryMedia(gallery, variant.media_id); });
  });

  /* ------------------------------------------------- gallery: hover zoom */

  // Desktop only: the photo under the cursor scales up around the pointer.
  // The <img> is scaled in place, so object-fit: cover crops stay correct,
  // and its `sizes` is raised while zoomed so the browser fetches a sharper
  // candidate from the srcset (once; it stays cached).
  var canHover = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  function activeZoomImage(main) {
    var slide = main.querySelector('.mh-gallery__slide.is-active[data-mh-zoom-src]');
    return slide ? slide.querySelector('img') : null;
  }

  function resetHoverZoom(main) {
    $$('.mh-gallery__slide img', main).forEach(function (img) {
      img.style.transform = '';
      img.style.transformOrigin = '';
    });
    main.classList.remove('is-zooming');
  }

  function initGalleryZoom(root) {
    if (!canHover) return;
    $$('[data-mh-hover-zoom]', root).forEach(function (main) {
      if (main._mhZoomBound) return;
      main._mhZoomBound = true;
      var level = parseFloat(main.getAttribute('data-mh-hover-zoom')) || 2;

      main.addEventListener('mousemove', function (event) {
        // Hovering the magnifier button should show the button, not zoom.
        if (event.target.closest('[data-mh-lightbox-open]')) { resetHoverZoom(main); return; }
        var img = activeZoomImage(main);
        if (!img) return;
        var rect = main.getBoundingClientRect();
        var x = Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100));
        var y = Math.min(100, Math.max(0, ((event.clientY - rect.top) / rect.height) * 100));
        if (!img._mhSharp) {
          img._mhSharp = true;
          img.setAttribute('sizes', Math.round(rect.width * level) + 'px');
        }
        img.style.transformOrigin = x + '% ' + y + '%';
        img.style.transform = 'scale(' + level + ')';
        main.classList.add('is-zooming');
      });
      main.addEventListener('mouseleave', function () { resetHoverZoom(main); });
    });
  }

  /* ------------------------------------------------- gallery: lightbox */

  var lightbox = null; // { dialog, gallery, items, index, zoomed, lastFocus }

  function lightboxItems(gallery) {
    return $$('[data-mh-zoom-src]', gallery).map(function (slide) {
      return {
        id: slide.getAttribute('data-mh-gallery-slide'),
        src: slide.getAttribute('data-mh-zoom-src'),
        alt: slide.getAttribute('data-mh-zoom-alt') || '',
        width: parseInt(slide.getAttribute('data-mh-zoom-width'), 10) || 0,
        height: parseInt(slide.getAttribute('data-mh-zoom-height'), 10) || 0
      };
    });
  }

  function preloadImage(src) {
    if (!src) return;
    var img = new Image();
    img.decoding = 'async';
    img.src = src;
  }

  function setLightboxZoom(on, clientX, clientY) {
    if (!lightbox) return;
    var dialog = lightbox.dialog;
    var stage = $('[data-mh-lightbox-stage]', dialog);
    var img = $('[data-mh-lightbox-img]', dialog);
    var toggle = $('[data-mh-lightbox-zoom]', dialog);
    if (!stage || !img) return;

    if (on) {
      var rect = img.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      // Zoom to the photo's real pixels, but never less than 2x or more than 3x.
      var natural = img.naturalWidth ? img.naturalWidth / rect.width : 2.5;
      var factor = Math.max(2, Math.min(3, natural));
      var px = clientX == null ? 0.5 : (clientX - rect.left) / rect.width;
      var py = clientY == null ? 0.5 : (clientY - rect.top) / rect.height;
      px = Math.min(1, Math.max(0, px));
      py = Math.min(1, Math.max(0, py));
      img.style.width = Math.round(rect.width * factor) + 'px';
      img.style.height = Math.round(rect.height * factor) + 'px';
      dialog.classList.add('is-zoomed');
      // Keep the point the shopper clicked under their finger / cursor.
      stage.scrollLeft = px * rect.width * factor - stage.clientWidth / 2;
      stage.scrollTop = py * rect.height * factor - stage.clientHeight / 2;
    } else {
      img.style.width = '';
      img.style.height = '';
      dialog.classList.remove('is-zoomed');
      stage.scrollLeft = 0;
      stage.scrollTop = 0;
    }
    lightbox.zoomed = on;
    if (toggle) toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function showLightboxItem(index) {
    if (!lightbox || !lightbox.items.length) return;
    var count = lightbox.items.length;
    lightbox.index = (index + count) % count;
    var item = lightbox.items[lightbox.index];
    var dialog = lightbox.dialog;
    var img = $('[data-mh-lightbox-img]', dialog);

    setLightboxZoom(false);
    if (img) {
      dialog.classList.add('is-loading');
      img.onload = img.onerror = function () { dialog.classList.remove('is-loading'); };
      if (item.width && item.height) {
        img.setAttribute('width', item.width);
        img.setAttribute('height', item.height);
      }
      img.alt = item.alt;
      img.src = item.src;
      if (img.complete) dialog.classList.remove('is-loading');
    }

    var counter = $('[data-mh-lightbox-count]', dialog);
    if (counter) counter.textContent = count > 1 ? (lightbox.index + 1) + ' / ' + count : '';
    dialog.classList.toggle('is-single', count < 2);

    if (count > 1) {
      preloadImage(lightbox.items[(lightbox.index + 1) % count].src);
      preloadImage(lightbox.items[(lightbox.index - 1 + count) % count].src);
    }
  }

  function openLightbox(gallery, mediaId) {
    var dialog = gallery ? $('[data-mh-lightbox]', gallery) : null;
    if (!dialog || typeof dialog.showModal !== 'function') return false;
    var items = lightboxItems(gallery);
    if (!items.length) return false;
    var start = 0;
    items.forEach(function (item, i) { if (String(item.id) === String(mediaId)) start = i; });

    lightbox = { dialog: dialog, gallery: gallery, items: items, index: start, zoomed: false, lastFocus: document.activeElement };
    bindLightbox(dialog);
    showLightboxItem(start);
    document.documentElement.classList.add('mh-lightbox-open');
    dialog.showModal();
    var close = $('[data-mh-lightbox-close]', dialog);
    if (close) close.focus();
    return true;
  }

  function closeLightbox() {
    if (!lightbox) return;
    var dialog = lightbox.dialog;
    if (dialog.open) dialog.close();
  }

  function bindLightbox(dialog) {
    if (dialog._mhBound) return;
    dialog._mhBound = true;
    var stage = $('[data-mh-lightbox-stage]', dialog);
    var swipe = null;
    var suppressClick = false;

    dialog.addEventListener('close', function () {
      document.documentElement.classList.remove('mh-lightbox-open');
      if (lightbox && lightbox.dialog === dialog) {
        setLightboxZoom(false);
        // Leave the page gallery on the photo the shopper ended on.
        var item = lightbox.items[lightbox.index];
        if (item) showGalleryMedia(lightbox.gallery, item.id);
        var back = lightbox.lastFocus;
        lightbox = null;
        if (back && back.focus) back.focus();
      }
    });

    dialog.addEventListener('click', function (event) {
      if (!lightbox) return;
      if (suppressClick) { suppressClick = false; return; }
      if (event.target.closest('[data-mh-lightbox-close]')) { closeLightbox(); return; }
      var step = event.target.closest('[data-mh-lightbox-step]');
      if (step) { showLightboxItem(lightbox.index + parseInt(step.getAttribute('data-mh-lightbox-step'), 10)); return; }
      if (event.target.closest('[data-mh-lightbox-zoom]')) { setLightboxZoom(!lightbox.zoomed); return; }
      if (event.target.closest('[data-mh-lightbox-img]')) {
        setLightboxZoom(!lightbox.zoomed, event.clientX, event.clientY);
        return;
      }
      // A click on the dark backdrop around the photo closes the viewer.
      if (event.target === stage || event.target === dialog) {
        if (lightbox.zoomed) setLightboxZoom(false);
        else closeLightbox();
      }
    });

    dialog.addEventListener('keydown', function (event) {
      if (!lightbox) return;
      if (event.key === 'ArrowRight') { event.preventDefault(); showLightboxItem(lightbox.index + 1); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); showLightboxItem(lightbox.index - 1); }
    });

    if (!stage) return;

    // Zoomed with a mouse: the photo follows the cursor, no dragging needed.
    // Touch keeps native scrolling, which pans the zoomed photo.
    stage.addEventListener('mousemove', function (event) {
      if (!lightbox || !lightbox.zoomed) return;
      var rect = stage.getBoundingClientRect();
      stage.scrollLeft = ((event.clientX - rect.left) / rect.width) * (stage.scrollWidth - stage.clientWidth);
      stage.scrollTop = ((event.clientY - rect.top) / rect.height) * (stage.scrollHeight - stage.clientHeight);
    });

    // Swipe between photos when not zoomed.
    stage.addEventListener('pointerdown', function (event) {
      if (!lightbox || lightbox.zoomed || event.pointerType === 'mouse') { swipe = null; return; }
      swipe = { x: event.clientX, y: event.clientY };
    });
    stage.addEventListener('pointerup', function (event) {
      if (!swipe || !lightbox) return;
      var dx = event.clientX - swipe.x;
      var dy = event.clientY - swipe.y;
      swipe = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        suppressClick = true;
        setTimeout(function () { suppressClick = false; }, 400);
        showLightboxItem(lightbox.index + (dx < 0 ? 1 : -1));
      }
    });
    stage.addEventListener('pointercancel', function () { swipe = null; });
  }

  // Opening: the magnifier button, or a click / tap on the photo itself.
  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!target || !target.closest) return;
    var gallery = target.closest('[data-mh-lightbox-enabled]');
    if (!gallery) return;
    var slide = target.closest('[data-mh-zoom-src]');
    if (!slide) return;
    if (openLightbox(gallery, slide.getAttribute('data-mh-gallery-slide'))) event.preventDefault();
  });

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
          var target = querySafe(selectTrigger.getAttribute('data-mh-select-scroll') || '#mh-buy');
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            if (CONFIG.preorder) focusWaitlistEmail();
          }
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

      var compareTab = event.target.closest('[data-mh-compare-tab]');
      if (compareTab) {
        event.preventDefault();
        var compare = compareTab.closest('[data-mh-compare-table]');
        if (compare) {
          compare.setAttribute('data-mh-compare-active', compareTab.getAttribute('data-mh-compare-tab'));
          $$('[data-mh-compare-tab]', compare).forEach(function (tab) {
            var on = tab === compareTab;
            tab.classList.toggle('is-active', on);
            tab.setAttribute('aria-selected', on ? 'true' : 'false');
          });
        }
        return;
      }

      var thumbTrigger = event.target.closest('[data-mh-gallery-thumb]');
      if (thumbTrigger) {
        event.preventDefault();
        showGalleryMedia(thumbTrigger.closest('[data-mh-gallery]'), thumbTrigger.getAttribute('data-mh-gallery-thumb'));
        return;
      }

      var playTrigger = event.target.closest('[data-mh-video-play]');
      if (playTrigger) {
        event.preventDefault();
        var playFrame = playTrigger.closest('[data-mh-video-frame]');
        var playVideo = playFrame ? playFrame.querySelector('[data-mh-video]') : null;
        // A deliberate tap on "play" is the one moment sound is welcome.
        if (playVideo) startVideo(playVideo, true);
        return;
      }

      var retryTrigger = event.target.closest('[data-mh-video-retry]');
      if (retryTrigger) {
        event.preventDefault();
        var retryFrame = retryTrigger.closest('[data-mh-video-frame]');
        var retryVideo = retryFrame ? retryFrame.querySelector('[data-mh-video]') : null;
        if (retryVideo) {
          // Start over on the small file: it is the one most likely to arrive.
          retryVideo.removeAttribute('src');
          retryVideo.removeAttribute('data-mh-tier');
          attachSource(retryVideo, true);
          startVideo(retryVideo, false);
        }
        return;
      }

      var soundTrigger = event.target.closest('[data-mh-video-sound]');
      if (soundTrigger) {
        event.preventDefault();
        var soundFrame = soundTrigger.closest('[data-mh-video-frame]');
        var soundVideo = soundFrame ? soundFrame.querySelector('[data-mh-video]') : null;
        if (soundVideo) toggleVideoSound(soundVideo);
        return;
      }

      var frameTrigger = event.target.closest('[data-mh-video-frame]');
      if (frameTrigger) {
        var frameVideo = frameTrigger.querySelector('[data-mh-video]');
        var frameState = frameTrigger.getAttribute('data-mh-video-state');
        if (frameVideo) {
          if (frameState === 'loading' && frameVideo._mh && frameVideo._mh.wantPlay) return;
          if (frameVideo.paused) startVideo(frameVideo, true);
          else if (frameVideo.muted) startVideo(frameVideo, true);
          else pauseVideo(frameVideo);
        }
        return;
      }

      var scrollTrigger = event.target.closest('[data-mh-scroll]');
      if (scrollTrigger) {
        var scrollTarget = querySafe(scrollTrigger.getAttribute('data-mh-scroll'));
        if (scrollTarget) {
          event.preventDefault();
          scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'start' });
          if (scrollTrigger.hasAttribute('data-mh-waitlist-open')) focusWaitlistEmail();
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

  /* -------------------------------------------------------- Loox rating */

  // The theme draws the stars itself from the Loox metafields, so the rating
  // is on the page in the first paint. Loox loads its own script asynchronously
  // and appends its rating into .loox-rating; the moment it has, the theme's
  // stars are dropped, so a row never shows two ratings at once.
  function initRating(scope) {
    $$('[data-mh-rating]', scope).forEach(function (row) {
      var fallback = row.querySelector('[data-mh-rating-fallback]');
      if (!fallback || row._mhRatingObserver) return;

      function dropFallback() {
        if (!row.querySelector('.loox-rating-content')) return false;
        if (fallback.parentNode) fallback.parentNode.removeChild(fallback);
        if (row._mhRatingObserver) row._mhRatingObserver.disconnect();
        row._mhRatingObserver = null;
        return true;
      }

      if (dropFallback()) return;
      if (typeof MutationObserver !== 'function') return;
      row._mhRatingObserver = new MutationObserver(dropFallback);
      row._mhRatingObserver.observe(row, { childList: true, subtree: true });
    });
  }

  /* ---------------------------------------------------------------- boot */

  function init() {
    initProduct();
    // Runs again here because a page can carry the waitlist without carrying
    // the product data (the interest page does), and the campaign tags have to
    // be attached either way.
    syncWaitlistTags();
    initStickyBar();
    initVideoCarousels();
    initInlineVideos();
    initGalleryZoom();
    initRating();
    initEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Theme editor: re-init when a section is re-rendered
  document.addEventListener('shopify:section:load', function (event) {
    variantsById = {};
    drawer = null;
    initProduct();
    initStickyBar();
    initVideoCarousels(event.target);
    initInlineVideos(event.target);
    initGalleryZoom(event.target);
    initRating(event.target);
  });
  document.addEventListener('shopify:section:unload', function (event) {
    $$('[data-mh-video]', event.target).forEach(sleepVideo);
    $$('[data-mh-carousel]', event.target).forEach(function (carousel) {
      if (carousel._mhObserver) carousel._mhObserver.disconnect();
      if (carousel._mhWarm) carousel._mhWarm.disconnect();
    });
  });
  document.addEventListener('shopify:block:select', function (event) {
    var slide = event.target && event.target.closest ? event.target.closest('[data-mh-video-slide]') : null;
    if (slide) slide.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
  });
})();
