/* Applies a light or dark choice saved in Settings before the page draws, so
   there is no flash of the other theme. With no choice saved the stylesheet
   follows the system setting on its own. Kept as a file (not inline) because
   the Content-Security-Policy only allows same-origin scripts. */
(function () {
  try {
    var mode = window.localStorage.getItem('ft_theme');
    if (mode === 'light' || mode === 'dark') {
      document.documentElement.setAttribute('data-theme', mode);
    }
  } catch (e) {
    /* Storage blocked: follow the system. */
  }
})();
