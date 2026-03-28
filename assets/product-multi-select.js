/* ═══════════════════════════════════════════════
   product-multi-select.js
   ═══════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', function () {
  var container = document.getElementById('msVariants');
  if (!container) return;

  var cards = container.querySelectorAll('.ms-variant:not(.is-soldout)');
  var countEl = document.getElementById('msCount');
  var totalEl = document.getElementById('msTotal');
  var addBtn = document.getElementById('msAddToCart');
  var toggleAllBtn = document.getElementById('msToggleAll');
  var mainImg = document.getElementById('msMainImage');
  var toast = document.getElementById('msToast');
  var moneyFormat = window.msMoneyFormat || '${{amount}}';

  /* ── Helpers ── */

  function formatMoney(cents) {
    var amount = (cents / 100).toFixed(2);
    return moneyFormat
      .replace(/\{\{\s*amount_with_comma_separator\s*\}\}/g, amount.replace('.', ','))
      .replace(/\{\{\s*amount_no_decimals_with_comma_separator\s*\}\}/g, Math.round(cents / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','))
      .replace(/\{\{\s*amount_no_decimals\s*\}\}/g, Math.round(cents / 100))
      .replace(/\{\{\s*amount\s*\}\}/g, amount);
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('is-visible');
    setTimeout(function () { toast.classList.remove('is-visible'); }, 2500);
  }

  /* ── State ── */

  function getSelected() {
    return container.querySelectorAll('.ms-variant.is-selected');
  }

  function updateSummary() {
    var selected = getSelected();
    var totalItems = 0;
    var totalCents = 0;

    selected.forEach(function (card) {
      var qty = parseInt(card.querySelector('.ms-qty__val').value) || 1;
      var price = parseInt(card.dataset.variantPrice);
      totalItems += qty;
      totalCents += price * qty;
    });

    var plural = totalItems > 1 ? 's' : '';
    countEl.textContent = totalItems + ' article' + plural + ' sélectionné' + plural;
    totalEl.textContent = formatMoney(totalCents);
    addBtn.disabled = totalItems === 0;
  }

  /* ── Card Toggle ── */

  function toggleCard(card) {
    card.classList.toggle('is-selected');
    card.setAttribute('aria-checked', card.classList.contains('is-selected'));
    updateSummary();
  }

  cards.forEach(function (card) {
    card.addEventListener('click', function (e) {
      if (e.target.closest('.ms-qty')) return;
      toggleCard(card);
    });
    card.addEventListener('keydown', function (e) {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        toggleCard(card);
      }
    });
  });

  /* ── Qty Controls ── */

  container.addEventListener('click', function (e) {
    var btn = e.target.closest('.ms-qty__btn');
    if (!btn) return;
    e.stopPropagation();

    var input = btn.parentElement.querySelector('.ms-qty__val');
    var val = parseInt(input.value) || 1;
    var max = parseInt(input.max) || 99;

    if (btn.dataset.action === 'increment' && val < max) val++;
    else if (btn.dataset.action === 'decrement' && val > 1) val--;

    input.value = val;
    updateSummary();
  });

  container.addEventListener('input', function (e) {
    if (e.target.classList.contains('ms-qty__val')) updateSummary();
  });

  /* ── Toggle All ── */

  var allSelected = false;
  toggleAllBtn.addEventListener('click', function () {
    allSelected = !allSelected;
    cards.forEach(function (card) {
      card.classList.toggle('is-selected', allSelected);
      card.setAttribute('aria-checked', allSelected);
    });
    toggleAllBtn.textContent = allSelected ? 'Tout désélectionner' : 'Tout sélectionner';
    updateSummary();
  });

  /* ── Thumbnail Gallery ── */

  document.querySelectorAll('.ms-gallery__thumb').forEach(function (thumb) {
    thumb.addEventListener('click', function () {
      document.querySelectorAll('.ms-gallery__thumb').forEach(function (t) { t.classList.remove('is-active'); });
      thumb.classList.add('is-active');
      if (mainImg) {
        mainImg.src = thumb.dataset.fullSrc;
        mainImg.alt = thumb.dataset.alt || '';
      }
    });
  });

  /* ── Add to Cart ── */

  addBtn.addEventListener('click', async function () {
    var selected = getSelected();
    if (!selected.length) return;

    addBtn.classList.add('is-loading');
    addBtn.disabled = true;

    var items = [];
    selected.forEach(function (card) {
      items.push({
        id: parseInt(card.dataset.variantId),
        quantity: parseInt(card.querySelector('.ms-qty__val').value) || 1
      });
    });

    try {
      var res = await fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: items })
      });
      if (!res.ok) throw new Error('Cart error');
      await res.json();

      var totalAdded = items.reduce(function (s, i) { return s + i.quantity; }, 0);
      showToast('✓ ' + totalAdded + ' article' + (totalAdded > 1 ? 's ajoutés' : ' ajouté') + ' au panier');

      // Reset
      selected.forEach(function (card) {
        card.classList.remove('is-selected');
        card.setAttribute('aria-checked', 'false');
        card.querySelector('.ms-qty__val').value = 1;
      });
      allSelected = false;
      toggleAllBtn.textContent = 'Tout sélectionner';
      updateSummary();

    } catch (err) {
      console.error('Add to cart failed:', err);
      showToast('Erreur lors de l\'ajout au panier');
    } finally {
      addBtn.classList.remove('is-loading');
      addBtn.disabled = !getSelected().length;
    }
  });

  updateSummary();
});