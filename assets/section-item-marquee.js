document.addEventListener('DOMContentLoaded', function () {
  var rows = document.querySelectorAll('.item-marquee__row');

  rows.forEach(function (row) {
    var track = row.querySelector('.item-marquee__track');
    if (!track) return;

    var pauseOnInteract = row.classList.contains('item-marquee__row--pause-on-hover');

    if (pauseOnInteract) {
      row.addEventListener('touchstart', function (e) {
        e.preventDefault();
        track.classList.add('is-paused');
      }, { passive: false });

      row.addEventListener('touchend', function () {
        track.classList.remove('is-paused');
      });

      row.addEventListener('touchcancel', function () {
        track.classList.remove('is-paused');
      });
    }

    row.addEventListener('contextmenu', function (e) {
      e.preventDefault();
    });

    row.addEventListener('dragstart', function (e) {
      e.preventDefault();
    });
  });
});