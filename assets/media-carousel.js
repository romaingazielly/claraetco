/**
 * <media-carousel>
 * Carousel média : 5 slides max, chaque slide accepte une image ou une vidéo.
 * La vidéo d'une slide ne démarre que lorsque cette slide devient active
 * ET que la section est visible à l'écran.
 *
 * Stratégie de chargement : seules la slide active et ses deux voisines sont
 * préchargées. Les autres restent en `preload="none"` / `loading="lazy"` pour
 * ne pas télécharger cinq vidéos plein écran au chargement de la page.
 */
class MediaCarousel extends HTMLElement {
  connectedCallback() {
    this.track = this.querySelector('[data-media-carousel-track]');
    this.slides = Array.from(this.querySelectorAll('.media-carousel__slide'));
    this.dots = Array.from(this.querySelectorAll('[data-media-carousel-dot]'));

    if (!this.track || this.slides.length === 0) return;

    this.currentIndex = 0;
    this.highlightedIndex = -1;
    this.isInViewport = false;
    this.isPaused = false;
    this.editorHold = false;
    this.programmaticScroll = false;
    this.autoplayTimer = null;
    this.scrollTimer = null;
    this.scrollRaf = null;
    this.mediaRaf = null;
    this.idleHandle = null;

    this.autoplayDelay = (parseFloat(this.dataset.speed) || 5) * 1000;
    this.autoplayRemaining = this.autoplayDelay;
    this.waitForVideo = this.dataset.waitForVideo === 'true';
    this.pauseOnHover = this.dataset.pauseOnHover !== 'false';
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.autoplayEnabled = this.dataset.autoplay === 'true' && this.slides.length > 1 && !this.reducedMotion;

    // Point de rupture desktop du thème. Interrogé via matchMedia plutôt que
    // via `offsetParent`, qui forcerait un recalcul de mise en page.
    this.desktopQuery = window.matchMedia('(min-width: 750px)');

    this.prepareVideos();
    this.bindEvents();
    this.setActive(0, { force: true });
    this.observeViewport();
  }

  disconnectedCallback() {
    this.clearAutoplayTimer();
    clearTimeout(this.scrollTimer);
    if (this.scrollRaf !== null) cancelAnimationFrame(this.scrollRaf);
    if (this.mediaRaf !== null) cancelAnimationFrame(this.mediaRaf);
    if (this.idleHandle !== null && typeof cancelIdleCallback === 'function') {
      cancelIdleCallback(this.idleHandle);
    }
    if (this.viewportObserver) this.viewportObserver.disconnect();
    if (this.resizeObserver) this.resizeObserver.disconnect();
    // Les écouteurs posés sur `document` survivraient à la suppression de la
    // section dans l'éditeur de thème.
    this.documentListeners.forEach(([type, handler]) => document.removeEventListener(type, handler));
  }

  /* ------------------------------------------------------------------ Vidéos */

  prepareVideos() {
    this.slides.forEach((slide) => {
      slide.querySelectorAll('video').forEach((video) => {
        // Indispensable sur iOS pour éviter le passage en plein écran.
        video.setAttribute('playsinline', '');
        video.playsInline = true;
        if (video.hasAttribute('muted')) video.muted = true;

        // Mémorisé une fois pour toutes : évite un `closest()` par lecture.
        const wrapper = video.closest('[data-viewport]');
        video.dataset.viewport = wrapper ? wrapper.dataset.viewport : 'any';

        video.addEventListener('ended', () => this.onVideoEnded(video));
      });
    });
  }

  videosOf(index) {
    const slide = this.slides[index];
    return slide ? Array.from(slide.querySelectorAll('video')) : [];
  }

  /**
   * Variantes desktop et mobile coexistent dans le DOM, l'une des deux étant en
   * `display: none`. On détermine laquelle est affichée sans lire la mise en
   * page.
   */
  isVideoDisplayed(video) {
    const viewport = video.dataset.viewport;
    if (viewport === 'any') return true;
    return viewport === 'desktop' ? this.desktopQuery.matches : !this.desktopQuery.matches;
  }

  visibleVideoOf(index) {
    return this.videosOf(index).find((video) => this.isVideoDisplayed(video)) || null;
  }

  /**
   * Précharge la slide active et ses deux voisines, décharge les autres. Sans
   * cela, la vidéo d'une slide ne commence à être téléchargée qu'une fois cette
   * slide arrivée à l'écran : elle n'apparaît qu'après un délai visible.
   */
  warmNeighbours() {
    const total = this.slides.length;
    const warm = new Set([(this.currentIndex - 1 + total) % total, this.currentIndex, (this.currentIndex + 1) % total]);

    this.slides.forEach((slide, index) => {
      const isWarm = warm.has(index);

      slide.querySelectorAll('video').forEach((video) => {
        // Inutile de précharger une variante qui n'est pas affichée à ce format.
        const wanted = isWarm && this.isVideoDisplayed(video) ? 'auto' : 'none';
        if (video.preload !== wanted) video.preload = wanted;
      });

      if (!isWarm) return;
      slide.querySelectorAll('img[loading="lazy"]').forEach((img) => {
        img.loading = 'eager';
      });
    });
  }

  updateVideoPlayback() {
    this.slides.forEach((slide, index) => {
      const isActive = index === this.currentIndex;

      this.videosOf(index).forEach((video) => {
        if (isActive && this.isInViewport && this.isVideoDisplayed(video)) {
          if (video.preload !== 'auto') video.preload = 'auto';
          const played = video.play();
          // Lecture refusée par le navigateur (son actif, économie d'énergie…)
          if (played) played.catch(() => {});
        } else if (!video.paused) {
          video.pause();
          if (!isActive) video.currentTime = 0;
        } else if (!isActive && video.currentTime > 0) {
          video.currentTime = 0;
        }
      });
    });
  }

  onVideoEnded(video) {
    if (!this.autoplayEnabled || !this.waitForVideo || video.loop) return;
    if (this.isPaused || this.editorHold || !this.isInViewport) return;
    if (video !== this.visibleVideoOf(this.currentIndex)) return;
    this.next();
  }

  /* --------------------------------------------------------------- Navigation */

  get slideWidth() {
    return this.track.clientWidth || 1;
  }

  indexFromScroll() {
    const index = Math.round(this.track.scrollLeft / this.slideWidth);
    return Math.min(this.slides.length - 1, Math.max(0, index));
  }

  goTo(index) {
    const target = Math.min(this.slides.length - 1, Math.max(0, index));
    // Empêche le défilement programmé de repasser par les points intermédiaires.
    this.programmaticScroll = true;
    this.setActive(target);
    this.track.scrollTo({
      left: target * this.slideWidth,
      behavior: this.reducedMotion ? 'auto' : 'smooth',
    });

    // Filet de sécurité : si la piste est déjà à la bonne position, aucun
    // évènement `scroll` n'est émis et le drapeau resterait bloqué.
    clearTimeout(this.scrollTimer);
    this.scrollTimer = setTimeout(() => this.commitScroll(), 700);
  }

  next() {
    this.goTo((this.currentIndex + 1) % this.slides.length);
  }

  /**
   * Bascule visuelle des points, sans toucher aux vidéos ni au défilement
   * automatique : appelée à chaque frame pendant un swipe pour un retour
   * immédiat, dès que le doigt passe la moitié de la slide.
   *
   * L'animation de remplissage repart d'elle-même : elle est portée par le
   * sélecteur `[aria-selected="true"]`, donc elle démarre sur le nouveau point.
   */
  highlightDot(index) {
    if (index === this.highlightedIndex) return;
    this.highlightedIndex = index;

    this.dots.forEach((dot, dotIndex) => {
      const isActive = dotIndex === index;
      dot.setAttribute('aria-selected', isActive ? 'true' : 'false');
      dot.tabIndex = isActive ? 0 : -1;
    });
  }

  setActive(index, { force = false } = {}) {
    if (index === this.currentIndex && !force) return;

    this.currentIndex = index;
    this.highlightDot(index);

    // `inert` retire les slides masquées de la navigation clavier. On l'évite
    // dans l'éditeur de thème, où il gênerait la sélection des blocs.
    if (!(window.Shopify && window.Shopify.designMode)) {
      this.slides.forEach((slide, slideIndex) => {
        slide.toggleAttribute('inert', slideIndex !== index && this.slides.length > 1);
      });
    }

    this.scheduleMediaUpdate();
  }

  /**
   * Le travail sur les médias (pause, remise à zéro — qui déclenche un seek —,
   * lecture d'une vidéo) peut bloquer le thread principal plusieurs dizaines de
   * millisecondes. Exécuté dans la même tâche que la mise à jour des points, il
   * retarde d'autant leur affichage : on l'exécute donc après le rendu.
   * Le préchargement des voisines, lui, attend un temps mort du navigateur.
   */
  scheduleMediaUpdate() {
    if (this.mediaRaf !== null) cancelAnimationFrame(this.mediaRaf);
    this.mediaRaf = requestAnimationFrame(() => {
      this.mediaRaf = null;
      setTimeout(() => {
        this.updateVideoPlayback();
        this.resetAutoplay();
        this.whenIdle(() => this.warmNeighbours());
      }, 0);
    });
  }

  whenIdle(callback) {
    if (typeof requestIdleCallback === 'function') {
      if (this.idleHandle !== null) cancelIdleCallback(this.idleHandle);
      this.idleHandle = requestIdleCallback(() => {
        this.idleHandle = null;
        callback();
      }, { timeout: 1200 });
    } else {
      setTimeout(callback, 300);
    }
  }

  /* ------------------------------------------------------ Défilement auto */

  canAutoplay() {
    return this.autoplayEnabled && this.isInViewport && !this.isPaused && !this.editorHold;
  }

  /** True si la slide active attend la fin de sa vidéo au lieu d'un minuteur. */
  waitsOnVideo() {
    if (!this.waitForVideo) return false;
    const video = this.visibleVideoOf(this.currentIndex);
    return Boolean(video) && !video.loop;
  }

  resetAutoplay() {
    this.autoplayRemaining = this.autoplayDelay;
    this.startAutoplay();
  }

  startAutoplay() {
    this.clearAutoplayTimer();

    // Le point actif n'affiche un remplissage progressif que si la slide est
    // pilotée par un minuteur (pas quand on attend la fin d'une vidéo).
    const timerDriven = this.autoplayEnabled && !this.waitsOnVideo();
    this.dataset.autoplayRunning = timerDriven ? 'true' : 'false';
    this.classList.toggle('media-carousel--paused', !this.canAutoplay());

    if (!this.canAutoplay() || !timerDriven) return;

    this.autoplayStartedAt = Date.now();
    this.autoplayTimer = setTimeout(() => this.next(), this.autoplayRemaining);
  }

  pauseAutoplay() {
    if (this.autoplayTimer) {
      this.autoplayRemaining = Math.max(0, this.autoplayRemaining - (Date.now() - this.autoplayStartedAt));
    }
    this.clearAutoplayTimer();
    this.classList.add('media-carousel--paused');
  }

  clearAutoplayTimer() {
    if (this.autoplayTimer) {
      clearTimeout(this.autoplayTimer);
      this.autoplayTimer = null;
    }
  }

  /* ------------------------------------------------------------ Évènements */

  /**
   * Pendant le défilement, les points suivent le doigt à la frame près ; les
   * traitements lourds attendent que le défilement soit terminé.
   */
  onScroll() {
    if (!this.programmaticScroll && this.scrollRaf === null) {
      this.scrollRaf = requestAnimationFrame(() => {
        this.scrollRaf = null;
        this.highlightDot(this.indexFromScroll());
      });
    }

    clearTimeout(this.scrollTimer);
    this.scrollTimer = setTimeout(() => this.commitScroll(), 90);
  }

  commitScroll() {
    clearTimeout(this.scrollTimer);
    this.programmaticScroll = false;
    this.setActive(this.indexFromScroll());
  }

  bindEvents() {
    this.documentListeners = [];

    this.track.addEventListener('scroll', () => this.onScroll(), { passive: true });

    // `scrollend` valide la slide dès l'arrêt réel du défilement, sans attendre
    // le minuteur de repli.
    if ('onscrollend' in window) {
      this.track.addEventListener('scrollend', () => this.commitScroll(), { passive: true });
    }

    this.dots.forEach((dot) => {
      dot.addEventListener('click', () => this.goTo(Number(dot.dataset.index)));
      dot.addEventListener('keydown', (event) => this.onDotKeydown(event));
    });

    if (this.pauseOnHover) {
      this.addEventListener('pointerenter', () => this.setPaused(true));
      this.addEventListener('pointerleave', () => this.setPaused(false));
    }

    this.addEventListener('focusin', () => this.setPaused(true));
    this.addEventListener('focusout', (event) => {
      if (!this.contains(event.relatedTarget)) this.setPaused(false);
    });

    // Pendant un swipe, on suspend le défilement automatique.
    this.track.addEventListener('touchstart', () => this.setPaused(true), { passive: true });
    this.track.addEventListener('touchend', () => this.setPaused(false), { passive: true });
    this.track.addEventListener('touchcancel', () => this.setPaused(false), { passive: true });

    this.onDocument('visibilitychange', () => {
      if (document.hidden) {
        this.pauseAutoplay();
        this.videosOf(this.currentIndex).forEach((video) => video.pause());
      } else {
        this.updateVideoPlayback();
        this.startAutoplay();
      }
    });

    // Le passage desktop/mobile change la variante de média affichée.
    this.desktopQuery.addEventListener('change', () => this.updateVideoPlayback());

    let lastWidth = this.slideWidth;
    this.resizeObserver = new ResizeObserver(() => {
      if (this.slideWidth === lastWidth) return;
      lastWidth = this.slideWidth;
      this.programmaticScroll = true;
      this.track.scrollTo({ left: this.currentIndex * this.slideWidth, behavior: 'auto' });
    });
    this.resizeObserver.observe(this.track);

    this.bindThemeEditor();
  }

  onDocument(type, handler) {
    this.documentListeners.push([type, handler]);
    document.addEventListener(type, handler);
  }

  onDotKeydown(event) {
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const target = event.key === 'Home' ? 0 : this.dots.length - 1;
      this.goTo(target);
      this.dots[target].focus();
      return;
    }

    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const target = (this.currentIndex + step + this.dots.length) % this.dots.length;
    this.goTo(target);
    this.dots[target].focus();
  }

  setPaused(paused) {
    this.isPaused = paused;
    if (paused) {
      this.pauseAutoplay();
    } else {
      this.startAutoplay();
    }
  }

  observeViewport() {
    this.viewportObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          this.isInViewport = entry.isIntersecting;
          this.updateVideoPlayback();
          if (entry.isIntersecting) {
            this.startAutoplay();
            this.whenIdle(() => this.warmNeighbours());
          } else {
            this.pauseAutoplay();
          }
        });
      },
      { threshold: 0.25 }
    );
    this.viewportObserver.observe(this);
  }

  /* ------------------------------------------------- Éditeur de thème Shopify */

  bindThemeEditor() {
    if (!window.Shopify || !window.Shopify.designMode) return;

    this.onDocument('shopify:block:select', (event) => {
      if (!this.contains(event.target)) return;
      const index = this.slides.indexOf(event.target.closest('.media-carousel__slide'));
      if (index === -1) return;
      this.editorHold = true;
      this.goTo(index);
      this.pauseAutoplay();
    });

    this.onDocument('shopify:block:deselect', (event) => {
      if (!this.contains(event.target)) return;
      this.editorHold = false;
      this.resetAutoplay();
    });
  }
}

if (!customElements.get('media-carousel')) {
  customElements.define('media-carousel', MediaCarousel);
}
